package com.renji.notebook;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class LoanReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (LoanReminders.ACTION.equals(intent.getAction())) {
            String id = intent.getStringExtra("loanId");
            if (id != null) LoanReminders.notifyDue(context, id);
        } else {
            LoanReminders.sync(context);
        }
    }
}
