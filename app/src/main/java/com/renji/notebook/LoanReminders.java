package com.renji.notebook;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.AtomicFile;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.Set;

final class LoanReminders {
    static final String STATE_FILE = "renji-notebook-state.json";
    static final String CHANNEL = "loan_due";
    static final String ACTION = "com.renji.notebook.LOAN_DUE";
    private static final String PREFS = "loan_reminders";

    static JSONObject readState(Context context) throws Exception {
        AtomicFile file = new AtomicFile(new File(context.getFilesDir(), STATE_FILE));
        try (FileInputStream input = file.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        }
    }

    static double remaining(JSONObject loan) {
        String key = "item".equals(loan.optString("kind")) ? "quantity" : "amount";
        if (loan.optBoolean("waived")) return 0;
        double total = loan.optDouble(key, 0);
        JSONArray entries = loan.optJSONArray("transactions");
        if (entries != null) for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.optJSONObject(i);
            if (entry != null) total -= Math.max(0, entry.optDouble(key, 0));
        }
        return Math.max(0, total);
    }

    static long dueMillis(JSONObject loan) {
        try {
            return LocalDate.parse(loan.optString("dueAt")).atTime(9, 0)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (Exception ignored) { return 0; }
    }

    static boolean enabled(JSONObject loan) {
        return loan != null && loan.optBoolean("reminderEnabled") && remaining(loan) > 0 && dueMillis(loan) > 0;
    }

    static PendingIntent pending(Context context, String id) {
        Intent intent = new Intent(context, LoanReminderReceiver.class).setAction(ACTION)
            .setData(new Uri.Builder().scheme("renji").authority("loan").appendPath(id).build())
            .putExtra("loanId", id);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static synchronized void sync(Context context) {
        try {
            JSONObject state;
            if (!new File(context.getFilesDir(), STATE_FILE).exists()) state = new JSONObject();
            else state = readState(context);
            JSONArray loans = state.optJSONArray("loans");
            AlarmManager alarms = context.getSystemService(AlarmManager.class);
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (alarms == null) return;
            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            Set<String> oldIds = new HashSet<>(preferences.getStringSet("scheduled", new HashSet<>()));
            for (String key : preferences.getAll().keySet()) {
                if (key.startsWith("shown:")) oldIds.add(key.substring(6));
            }
            Set<String> currentIds = new HashSet<>();
            Set<String> liveIds = new HashSet<>();
            if (loans != null) for (int i = 0; i < loans.length(); i++) {
                JSONObject loan = loans.optJSONObject(i);
                if (loan == null) continue;
                String id = loan.optString("id");
                if (id.isEmpty()) continue;
                liveIds.add(id);
                if (!enabled(loan)) {
                    alarms.cancel(pending(context, id));
                    if (manager != null) manager.cancel(id, 1);
                    continue;
                }
                String date = loan.optString("dueAt");
                if (date.equals(preferences.getString("shown:" + id, ""))) continue;
                currentIds.add(id);
                long time = Math.max(System.currentTimeMillis() + 10000, dueMillis(loan));
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, pending(context, id));
            }
            for (String id : oldIds) if (!currentIds.contains(id)) {
                alarms.cancel(pending(context, id));
                if (!liveIds.contains(id) && manager != null) manager.cancel(id, 1);
            }
            SharedPreferences.Editor updates = preferences.edit().putStringSet("scheduled", currentIds);
            for (String id : oldIds) if (!liveIds.contains(id)) updates.remove("shown:" + id);
            updates.apply();
        } catch (Exception error) {
            Log.w("RenjiReminder", "Could not synchronize reminders", error);
        }
    }

    static synchronized void notifyDue(Context context, String id) {
        try {
            JSONObject state = readState(context);
            JSONArray loans = state.optJSONArray("loans");
            if (loans == null) return;
            JSONObject loan = null;
            for (int i = 0; i < loans.length(); i++) {
                JSONObject candidate = loans.optJSONObject(i);
                if (candidate != null && id.equals(candidate.optString("id"))) { loan = candidate; break; }
            }
            if (!enabled(loan) || dueMillis(loan) > System.currentTimeMillis()) return;
            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String date = loan.optString("dueAt");
            if (date.equals(preferences.getString("shown:" + id, ""))) return;
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null || !manager.areNotificationsEnabled()) return;
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "借貸到期提醒", NotificationManager.IMPORTANCE_DEFAULT));
            String name = "人物";
            JSONArray people = state.optJSONArray("people");
            if (people != null) for (int i = 0; i < people.length(); i++) {
                JSONObject person = people.optJSONObject(i);
                if (person != null && loan.optString("personId").equals(person.optString("id"))) { name = person.optString("name", "人物"); break; }
            }
            Intent launch = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent open = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String body = name + "｜" + loan.optString("title", "借貸") + " 已到約定歸還日期";
            Notification notification = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_reminder).setContentTitle("借貸到期提醒").setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body)).setContentIntent(open)
                .setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build();
            manager.notify(id, 1, notification);
            preferences.edit().putString("shown:" + id, date).apply();
        } catch (Exception error) {
            Log.w("RenjiReminder", "Could not show reminder", error);
        }
    }
}
