package com.renji.notebook;

import static org.junit.Assert.*;
import android.content.Context;
import android.app.NotificationManager;
import android.content.res.AssetFileDescriptor;
import android.media.MediaMetadataRetriever;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.file.Files;
import java.io.File;
import java.time.LocalDate;

@RunWith(AndroidJUnit4.class)
public class LoanReminderTest {
    @Test public void reminderSchedulingCancellationAndNoDuplicateDelivery() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = new File(context.getFilesDir(), LoanReminders.STATE_FILE);
        byte[] before = file.exists() ? Files.readAllBytes(file.toPath()) : null;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        String id = "reminder-test";
        try {
            JSONObject loan = new JSONObject().put("id", id).put("personId", "p").put("kind", "money").put("amount", 100).put("title", "測試借貸")
                .put("reminderEnabled", true).put("dueAt", LocalDate.now().plusDays(1).toString()).put("transactions", new JSONArray());
            JSONObject state = new JSONObject().put("loans", new JSONArray().put(loan)).put("people", new JSONArray().put(new JSONObject().put("id", "p").put("name", "測試")));
            Files.write(file.toPath(), state.toString().getBytes("UTF-8"));
            LoanReminders.sync(context);
            assertTrue(context.getSharedPreferences("loan_reminders", Context.MODE_PRIVATE).getStringSet("scheduled", java.util.Collections.emptySet()).contains(id));
            loan.put("dueAt", LocalDate.now().minusDays(1).toString());
            Files.write(file.toPath(), state.toString().getBytes("UTF-8"));
            LoanReminders.notifyDue(context, id);
            long first = java.util.Arrays.stream(manager.getActiveNotifications()).filter(n -> id.equals(n.getTag())).count();
            assertEquals(1L, first);
            LoanReminders.notifyDue(context, id);
            assertEquals(1L, java.util.Arrays.stream(manager.getActiveNotifications()).filter(n -> id.equals(n.getTag())).count());
            loan.put("transactions", new JSONArray().put(new JSONObject().put("amount", 100)));
            Files.write(file.toPath(), state.toString().getBytes("UTF-8"));
            LoanReminders.sync(context);
            assertFalse(context.getSharedPreferences("loan_reminders", Context.MODE_PRIVATE).getStringSet("scheduled", java.util.Collections.emptySet()).contains(id));
            assertEquals(0L, java.util.Arrays.stream(manager.getActiveNotifications()).filter(n -> id.equals(n.getTag())).count());
            JSONObject item = new JSONObject().put("kind","item").put("quantity",3).put("transactions",new JSONArray().put(new JSONObject().put("amount",0).put("quantity",1)));
            assertEquals(2.0,LoanReminders.remaining(item),0.001);
        } finally {
            manager.cancel(id, 1);
            context.getSharedPreferences("loan_reminders", Context.MODE_PRIVATE).edit().remove("shown:" + id).apply();
            if (before == null) file.delete(); else Files.write(file.toPath(), before);
            LoanReminders.sync(context);
        }
    }

    @Test public void originalIntroIsAnAndroidPlayableAudioAsset() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (AssetFileDescriptor fd = context.getAssets().openFd("web/audio/intro.m4a")) {
            MediaMetadataRetriever media = new MediaMetadataRetriever();
            try {
                media.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
                long duration = Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
                assertTrue(duration > 9000 && duration < 10000);
                assertEquals("yes", media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO));
            } finally { media.release(); }
        }
    }
}
