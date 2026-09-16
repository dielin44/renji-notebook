package com.renji.notebook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class AppSmokeTest {
    @Rule
    public ActivityScenarioRule<MainActivity> activityRule =
        new ActivityScenarioRule<>(MainActivity.class);

    @Before
    public void waitForWebPage() throws Exception {
        AtomicReference<MainActivity> activityReference = new AtomicReference<>();
        activityRule.getScenario().onActivity(activityReference::set);
        MainActivity activity = activityReference.get();
        assertNotNull("Activity was not created", activity);
        assertTrue("WebView page did not finish loading",
            activity.awaitWebPageForTesting(45, TimeUnit.SECONDS));
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }

    private String evaluate(String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        activityRule.getScenario().onActivity(activity ->
            activity.getWebViewForTesting().evaluateJavascript(script, value -> {
                result.set(value);
                latch.countDown();
            })
        );
        assertTrue("JavaScript evaluation timed out for: " + script,
            latch.await(30, TimeUnit.SECONDS));
        return result.get();
    }

    private void runJs(String script) throws Exception {
        String result = evaluate("(function(){" + script + ";return true;})()");
        assertEquals("JavaScript failed: " + script, "true", result);
    }

    private void waitUntil(String condition) throws Exception {
        long deadline = System.currentTimeMillis() + 20000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate("Boolean(" + condition + ")"))) return;
            Thread.sleep(180);
        }
        String diagnostics = evaluate("JSON.stringify({" +
            "ready:document.readyState," +
            "sheetOpen:Boolean(document.getElementById('sheet')&&document.getElementById('sheet').open)," +
            "navLabels:Array.from(document.querySelectorAll('.nav-label')).map(function(e){return e.innerText})," +
            "formId:document.querySelector('#sheet form')?document.querySelector('#sheet form').getAttribute('id'):''," +
            "formValid:document.querySelector('#sheet form')?document.querySelector('#sheet form').checkValidity():null," +
            "formError:(document.querySelector('[data-form-error]')||{}).innerText||''," +
            "saveLabel:(document.querySelector('[data-action=\\\"save-form\\\"]')||{}).innerText||''," +
            "saveDisabled:Boolean((document.querySelector('[data-action=\\\"save-form\\\"]')||{}).disabled)," +
            "toast:(document.getElementById('toast')||{}).innerText||''," +
            "storage:(window.RenjiStore&&window.RenjiStore.diagnostics)?window.RenjiStore.diagnostics():null," +
            "nativeState:(window.AndroidBridge&&window.AndroidBridge.loadState)?String(window.AndroidBridge.loadState()).slice(0,240):''" +
            "})");
        throw new AssertionError("Condition timed out: " + condition + " diagnostics=" + diagnostics);
    }

    private void screenshot(String name) throws Exception {
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        android.os.SystemClock.sleep(800);
        CountDownLatch painted = new CountDownLatch(1);
        activityRule.getScenario().onActivity(activity -> activity.getWebViewForTesting().postVisualStateCallback(1,
            new android.webkit.WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    activity.getWebViewForTesting().invalidate();
                    painted.countDown();
                }
            }));
        assertTrue("WebView did not finish painting", painted.await(10, TimeUnit.SECONDS));
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        android.os.SystemClock.sleep(100);
        if ("true".equals(evaluate("document.getElementById('sheet').open"))) {
            assertEquals("Dialog must be visible in the viewport", "true", evaluate("(function(){var s=document.getElementById('sheet'),r=s.getBoundingClientRect();return r.height>100&&r.width>100&&r.top>=-1&&r.bottom<=innerHeight+1&&parseFloat(getComputedStyle(s).opacity)>0.99;})()"));
        }
        android.graphics.Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(bitmap);
        java.io.File directory = InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir("qa");
        directory.mkdirs();
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(new java.io.File(directory, name + ".png"))) {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output);
        }
        bitmap.recycle();
        // UTP uninstalls the application after tests. Keep QA images in the shell-owned test directory.
        String source = new java.io.File(directory, name + ".png").getAbsolutePath();
        for (String command : new String[] {"mkdir -p /data/local/tmp/renji-qa", "cp " + source + " /data/local/tmp/renji-qa/" + name + ".png"}) {
            try (android.os.ParcelFileDescriptor.AutoCloseInputStream output = new android.os.ParcelFileDescriptor.AutoCloseInputStream(
                    InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) {
                while (output.read() != -1) { }
            }
        }
    }

    private void mark(String step) {
        Log.i("RenjiTest", step);
    }

    private void tapVisibleElement(String selector) throws Exception {
        pressVisibleElement(selector, 70);
    }

    private void pressVisibleElement(String selector, int holdMs) throws Exception {
        runJs("document.querySelector(" + org.json.JSONObject.quote(selector) + ").scrollIntoView({block:'center'})");
        android.os.SystemClock.sleep(180);
        org.json.JSONArray point = new org.json.JSONArray(evaluate("(function(){var r=document.querySelector(" + org.json.JSONObject.quote(selector) + ").getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,innerWidth,innerHeight];})()"));
        assertTrue("Control must be inside viewport", point.getDouble(0)>0 && point.getDouble(0)<point.getDouble(2) && point.getDouble(1)>0 && point.getDouble(1)<point.getDouble(3));
        final float[] target = new float[2];
        final float x = (float) point.getDouble(0), y = (float) point.getDouble(1), width = (float) point.getDouble(2);
        activityRule.getScenario().onActivity(activity -> {
            android.webkit.WebView view = activity.getWebViewForTesting();
            int[] location = new int[2];
            view.getLocationOnScreen(location);
            target[0] = location[0] + x * view.getWidth() / width;
            target[1] = location[1] + y * view.getWidth() / width;
        });
        long down = android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent press = android.view.MotionEvent.obtain(down, down, android.view.MotionEvent.ACTION_DOWN, target[0], target[1], 0);
        android.view.MotionEvent release = android.view.MotionEvent.obtain(down, down + holdMs, android.view.MotionEvent.ACTION_UP, target[0], target[1], 0);
        try {
            InstrumentationRegistry.getInstrumentation().sendPointerSync(press);
            android.os.SystemClock.sleep(holdMs);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(release);
        } finally { press.recycle(); release.recycle(); }
    }

    @Test
    public void directButtonsCreateModifyAndDeleteData() throws Exception {
        mark("START");
        waitUntil("document.querySelector('[data-action=\"add-person\"]') !== null");
        assertEquals("true", evaluate("(function(){var r=document.querySelector('.bottom-nav').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.width>=Math.min(600,innerWidth)*0.95;})()"));
        assertEquals("true", evaluate("(function(){var r=document.querySelector('.fab').getBoundingClientRect();return r.left>innerWidth*0.65&&r.right<=innerWidth;})()"));

        runJs("document.querySelector('[data-action=\"add-person\"]').click()");
        waitUntil("document.getElementById('person-form') !== null");
        mark("PERSON_FORM_OPEN");
        runJs("var f=document.getElementById('person-form');f.elements.name.value='測試人物';f.elements.birthday.value='1987-01-15';f.elements.bloodType.value='O';f.elements.startScore.value='95';var raw=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');var bytes=Uint8Array.from(raw,function(c){return c.charCodeAt(0);});var file=new File([bytes],'avatar.png',{type:'image/png'});if(typeof DataTransfer==='function'){var dt=new DataTransfer();dt.items.add(file);f.elements.avatar.files=dt.files;}else{Object.defineProperty(f.elements.avatar,'files',{value:[file]});}");
        runJs("document.querySelector('[data-action=\"add-custom-field\"]').click();var f=document.getElementById('person-form');f.elements.customFieldLabel.value='公司';f.elements.customFieldValue.value='共用欄位測試'");
        assertEquals("true", evaluate("document.getElementById('person-form').checkValidity()"));
        runJs("document.querySelector('#person-form [data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('測試人物') >= 0 && !document.getElementById('sheet').open");
        waitUntil("document.querySelector('.person-card [data-action=\"view-avatar\"] img') !== null");
        assertEquals("true", evaluate("Boolean(JSON.parse(window.AndroidBridge.loadState()).people.find(function(p){return p.name==='測試人物'&&p.birthday==='1987-01-15'&&p.zodiac==='摩羯座'&&p.bloodType==='O'&&p.avatar&&p.avatar.dataUrl;}))"));
        assertEquals("true", evaluate("document.querySelector('[aria-label=\"人物品質摘要\"]').innerText.indexOf('優質')>=0&&document.querySelector('[aria-label=\"人物品質摘要\"]').innerText.indexOf('劣質')>=0&&document.querySelector('[aria-label=\"人物品質摘要\"] .summary-item:nth-child(2) .summary-value').innerText==='1'"));
        runJs("document.querySelector('.person-card [data-action=\"view-avatar\"]').click()");
        waitUntil("document.querySelector('.avatar-viewer img') !== null");
        runJs("document.querySelector('[data-action=\"close-sheet\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        mark("PERSON_SAVED");

        runJs("var c=Array.from(document.querySelectorAll('.person-card')).find(function(x){return x.innerText.indexOf('測試人物')>=0;});c.querySelector('[data-action=\"show-person\"]').click()");
        waitUntil("document.querySelector('[data-action=\"edit-person\"]') !== null");
        assertEquals("true", evaluate("document.getElementById('sheet-content').innerText.indexOf('生日')>=0&&document.getElementById('sheet-content').innerText.indexOf('摩羯座')>=0&&document.getElementById('sheet-content').innerText.indexOf('O 型')>=0&&document.getElementById('sheet-content').innerText.indexOf('認識日期')<0"));
        runJs("document.querySelector('[data-action=\"edit-person\"]').click()");
        waitUntil("document.getElementById('person-form') !== null");
        runJs("var f=document.getElementById('person-form');f.elements.nickname.value='已修改';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        screenshot("people");
        mark("PERSON_EDITED");

        mark("LOANS_NAV_BEFORE");
        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"loans\"]').click()");
        mark("LOANS_NAV_AFTER");
        waitUntil("document.querySelector('[data-action=\"primary-add\"]') !== null");
        mark("LOANS_READY");
        runJs("document.querySelector('[data-action=\"primary-add\"]').click()");
        mark("LOAN_ADD_CLICKED");
        waitUntil("document.getElementById('loan-form') !== null");
        mark("LOAN_FORM_OPEN");
        runJs("var f=document.getElementById('loan-form');f.elements.title.value='測試借款';f.elements.amount.value='100';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('測試借款') >= 0 && !document.getElementById('sheet').open");
        mark("LOAN_SAVED");
        waitUntil("document.querySelector('.loan-card [data-action=\"add-transaction\"]') !== null");
        runJs("document.querySelector('.loan-card [data-action=\"add-transaction\"]').click()");
        waitUntil("document.getElementById('transaction-form') !== null");
        mark("TRANSACTION_FORM_OPEN");
        runJs("var f=document.getElementById('transaction-form');f.elements.value.value='40';f.querySelector('[data-action=\"save-form\"]').click()");
        assertEquals("true", evaluate("document.querySelector('#transaction-form [data-score-control]')===null"));
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        waitUntil("window.RenjiLogic.loanRemaining(JSON.parse(window.AndroidBridge.loadState()).loans.find(function(x){return x.title==='測試借款';})) === 60");
        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"people\"]').click()");
        waitUntil("document.querySelector('.person-card [data-action=\"show-person-loans\"]') !== null");
        runJs("document.querySelector('.person-card [data-action=\"show-person-loans\"]').click()");
        waitUntil("document.getElementById('sheet-content').innerText.indexOf('借貸關係') >= 0");
        assertEquals("true", evaluate("document.querySelector('#sheet-content .sheet-head h2').innerText.indexOf('往來明細')<0"));
        runJs("document.querySelector('[data-action=\"close-sheet\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        mark("TRANSACTION_SAVED");
        assertEquals("0", evaluate("JSON.parse(window.AndroidBridge.loadState()).events.length"));
        runJs("document.querySelector('.person-card [data-action=\"show-person\"]').click();document.querySelector('[data-action=\"edit-person-notes\"]').click()");
        waitUntil("document.getElementById('person-notes-form')!==null");
        runJs("var f=document.getElementById('person-notes-form');f.elements.notes.value='新的備註';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("JSON.parse(window.AndroidBridge.loadState()).people[0].notes==='新的備註'"));
        runJs("document.querySelector('.person-card [data-action=\"show-person-loans\"]').click();document.querySelector('#sheet [data-action=\"show-loan\"]').click();document.querySelector('[data-action=\"edit-transaction\"]').click()");
        waitUntil("document.getElementById('transaction-form')!==null");
        runJs("var f=document.getElementById('transaction-form');f.elements.value.value='30';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("70", evaluate("window.RenjiLogic.loanRemaining(JSON.parse(window.AndroidBridge.loadState()).loans[0])"));
        runJs("document.querySelector('.person-card [data-action=\"show-person-loans\"]').click();document.querySelector('#sheet [data-action=\"show-loan\"]').click();document.querySelector('[data-action=\"delete-transaction\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("100", evaluate("window.RenjiLogic.loanRemaining(JSON.parse(window.AndroidBridge.loadState()).loans[0])"));


        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"settings\"]').click()");
        waitUntil("document.querySelector('[data-action=\"add-category\"]') !== null");
        mark("SETTINGS_OPEN");
        assertEquals("true", evaluate("String(window.AndroidBridge.getStoragePath()).endsWith('renji-notebook-state.json')"));
        assertEquals("true", evaluate("document.querySelector('.storage-path-block code').innerText.indexOf('renji-notebook-state.json')>=0"));
        assertEquals("true", evaluate("document.body.innerText.indexOf('v1.2.0')>=0"));
        assertEquals("true", evaluate("document.querySelector('[data-action=\"edit-quick-tags\"]') !== null"));
        runJs("document.querySelector('[data-action=\"add-category\"]').click()");
        waitUntil("document.getElementById('category-form') !== null");
        runJs("var f=document.getElementById('category-form');f.elements.name.value='測試分類';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('測試分類') >= 0 && !document.getElementById('sheet').open");

        runJs("var b=Array.from(document.querySelectorAll('[data-action=\"edit-category\"]')).find(function(x){return x.closest('.settings-line').innerText.indexOf('測試分類')>=0;});b.click()");
        waitUntil("document.getElementById('category-form') !== null");
        runJs("var f=document.getElementById('category-form');f.elements.name.value='分類已修改';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('分類已修改') >= 0 && !document.getElementById('sheet').open");
        mark("CATEGORY_DONE");
        runJs("document.querySelector('[data-action=\"edit-tag-style\"]').click()");
        waitUntil("document.getElementById('tag-style-form')!==null");
        screenshot("tag-styles");
        tapVisibleElement("#tag-style-form [name=style][value=neon]");
        waitUntil("document.querySelector('#tag-style-form [name=style][value=neon]').checked");
        tapVisibleElement("#tag-style-form [data-action=\"save-form\"]");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("document.querySelector('.tag-settings-row .tag').classList.contains('tag-theme-neon')"));
        runJs("document.querySelector('[data-action=\"edit-title-settings\"]').click()");
        waitUntil("document.getElementById('title-settings-form')!==null");
        runJs("var f=document.getElementById('title-settings-form');f.elements.appTitle.value='測試小本本';f.elements.appSubtitle.value='生活紀錄';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("document.querySelector('.brand h1').innerText==='測試小本本'"));


        runJs("document.querySelector('[data-action=\"edit-quick-tags\"]').click()");
        waitUntil("document.getElementById('quick-tags-form') !== null");
        runJs("var f=document.getElementById('quick-tags-form');Array.from(f.elements.quickTags).forEach(function(x){x.checked=x.value==='需觀察';});f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("JSON.stringify(JSON.parse(window.AndroidBridge.loadState()).settings.quickTags)==='[\\\"需觀察\\\"]'"));

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"events\"]').click()");
        waitUntil("document.querySelector('[data-action=\"primary-add\"]') !== null");
        runJs("document.querySelector('[data-action=\"primary-add\"]').click()");
        waitUntil("document.getElementById('event-form') !== null");
        runJs("var f=document.getElementById('event-form');f.elements.title.value='主動守約';f.elements.deltaAmount.value='7';f.elements.important.checked=true;f.querySelector('[data-action=\"set-score-sign\"][data-sign=\"1\"]').click();f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('主動守約') >= 0 && !document.getElementById('sheet').open");
        mark("EVENT_SAVED");
        waitUntil("Boolean(Array.from(document.querySelectorAll('.event-card.important-event')).find(function(x){return x.innerText.indexOf('主動守約')>=0;}))");
        assertEquals("true", evaluate("getComputedStyle(Array.from(document.querySelectorAll('.event-card.important-event')).find(function(x){return x.innerText.indexOf('主動守約')>=0;})).borderColor!=='rgba(0, 0, 0, 0)'"));

        runJs("document.querySelector('[data-action=\"primary-add\"]').click()");
        waitUntil("document.getElementById('event-form') !== null");
        runJs("var f=document.getElementById('event-form');f.elements.title.value='違約扣分';f.elements.deltaAmount.value='3';f.querySelector('[data-action=\"set-score-sign\"][data-sign=\"-1\"]').click();f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('違約扣分') >= 0 && !document.getElementById('sheet').open");

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"people\"]').click()");
        waitUntil("Boolean(Array.from(document.querySelectorAll('.person-card')).find(function(x){return x.innerText.indexOf('測試人物')>=0;}))");
        assertEquals("true", evaluate("Boolean(Array.from(document.querySelectorAll('.quick-tags .chip')).find(function(x){return x.innerText==='需觀察';}))"));
        runJs("var c=Array.from(document.querySelectorAll('.person-card')).find(function(x){return x.innerText.indexOf('測試人物')>=0;});c.querySelector('[data-action=\"show-person\"]').click()");
        waitUntil("document.querySelector('[data-action=\"show-person-events\"]') !== null");
        runJs("document.querySelector('[data-action=\"show-person-events\"]').click()");
        waitUntil("document.querySelector('.subtabs.two-tabs') !== null");
        assertEquals("true", evaluate("document.getElementById('sheet-content').innerText.indexOf('往來明細')>=0&&document.getElementById('sheet-content').innerText.indexOf('加分 1')>=0&&document.getElementById('sheet-content').innerText.indexOf('扣分 1')>=0&&document.getElementById('sheet-content').innerText.indexOf('主動守約')>=0"));
        runJs("document.querySelector('[data-action=\"show-person-events\"][data-event-polarity=\"negative\"]').click()");
        waitUntil("document.getElementById('sheet-content').innerText.indexOf('違約扣分')>=0");
        assertEquals("true", evaluate("document.getElementById('sheet-content').innerText.indexOf('主動守約')<0"));
        runJs("document.querySelector('[data-action=\"close-sheet\"]').click();document.querySelector('[data-action=\"nav\"][data-view=\"events\"]').click()");
        waitUntil("Boolean(Array.from(document.querySelectorAll('.event-card')).find(function(x){return x.innerText.indexOf('主動守約')>=0;}))");

        runJs("var e=Array.from(document.querySelectorAll('.event-card')).find(function(x){return x.innerText.indexOf('主動守約')>=0;});e.click()");
        waitUntil("document.querySelector('[data-action=\"delete-event\"]') !== null");
        runJs("document.querySelector('[data-action=\"delete-event\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("document.body.innerText.indexOf('主動守約') < 0 && !document.getElementById('confirm-dialog').open");

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"settings\"]').click();document.querySelector('[data-action=\"set-pin\"]').click()");
        waitUntil("document.getElementById('pin-form') !== null");
        runJs("var f=document.getElementById('pin-form');f.elements.pin.value='2468';f.elements.confirmPin.value='2468';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('已啟用') >= 0 && !document.getElementById('sheet').open");
        runJs("document.querySelector('[data-action=\"remove-pin\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("document.body.innerText.indexOf('未啟用') >= 0 && !document.getElementById('confirm-dialog').open");
        mark("PIN_DONE");

        runJs("document.querySelector('[data-action=\"clear-all\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("!document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"people\"]').click()");
        waitUntil("document.body.innerText.indexOf('建立第一位人物') >= 0");
        mark("DONE");
    }


    private void importTestBackup() throws Exception {
        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"settings\"]').click()");
        runJs("var input=document.getElementById('backup-file');var file=new File([JSON.stringify(window.__testBackup)],'test-backup.json',{type:'application/json'});if(typeof DataTransfer==='function'){var dt=new DataTransfer();dt.items.add(file);input.files=dt.files}else{Object.defineProperty(input,'files',{value:[file],configurable:true})}input.dispatchEvent(new Event('change',{bubbles:true}))");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("!document.getElementById('confirm-dialog').open&&document.querySelector('.nav-button.active').dataset.view==='people'");
    }

    @Test
    public void confirmedFeatureChecklist() throws Exception {
        waitUntil("document.querySelector('.bottom-nav')!==null");
        runJs("var s=RenjiLogic.createDefaultState();s.settings.appTitle='驗收小本本';s.settings.appSubtitle='每一天，都值得留下';window.__testBackup=s");
        importTestBackup();
        runJs("window.__beforeReload=true;location.reload()");
        waitUntil("window.__beforeReload!==true&&document.querySelectorAll('.nav-label').length===5");
        waitUntil("document.querySelector('.brand h1')&&document.querySelector('.brand h1').innerText==='驗收小本本'");
        assertEquals("true", evaluate("Boolean(Array.from(document.querySelectorAll('.nav-label')).map(function(x){return x.innerText}).join(',')==='人物,隨筆,借貸,事件,設定')"));
        assertEquals("true", evaluate("Boolean(Array.from(document.querySelectorAll('.nav-button')).every(function(x){var r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.width>50}))"));
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"journal\\\"]\").click()");
        runJs("document.querySelector(\"[data-action=\\\"add-journal\\\"][data-kind=\\\"note\\\"]\").click()");
        waitUntil("document.getElementById('journal-form')!==null");
        runJs("var f=document.getElementById('journal-form');f.elements.title.value='咖啡靈感';f.elements.content.value='寫給自己的隨手筆記\\n生活裡的小小發現。'");
        runJs("document.querySelector(\"#journal-form [data-action=\\\"save-form\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).journal.length===1&&JSON.parse(AndroidBridge.loadState()).people.length===0)"));
        runJs("document.querySelector(\"[data-action=\\\"add-journal\\\"][data-kind=\\\"todo\\\"]\").click()");
        waitUntil("document.getElementById('journal-form')!==null");
        runJs("var f=document.getElementById('journal-form');f.elements.title.value='買咖啡豆';f.elements.content.value='週末的早餐';var d=new Date(Date.now()+3600000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());f.elements.dueAt.value=d.toISOString().slice(0,16)");
        runJs("document.querySelector(\"#journal-form [data-action=\\\"save-form\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("Boolean(document.querySelector('.journal-card.status-upcoming')!==null)"));
        runJs("var search=document.querySelector('[data-role=search]');search.value='咖啡';search.dispatchEvent(new Event('input',{bubbles:true}))");
        assertEquals("true", evaluate("Boolean(document.querySelectorAll('.journal-card').length===2)"));
        screenshot("v120-journal-dark");
        runJs("document.querySelector(\".journal-complete\").click()");
        waitUntil("document.querySelector('.status-done')!==null");
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"people\\\"]\").click()");
        assertEquals("true", evaluate("Boolean(document.querySelector('.upcoming-section')===null)"));
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"journal\\\"]\").click()");
        runJs("document.querySelector(\".journal-complete\").click()");
        waitUntil("document.querySelector('.status-upcoming')!==null");
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"people\\\"]\").click()");
        assertEquals("true", evaluate("Boolean(document.querySelectorAll('.upcoming-row').length===1)"));
        runJs("document.querySelector(\".upcoming-row\").click()");
        waitUntil("document.querySelector('[data-action=edit-journal]')!==null");
        runJs("document.querySelector(\"[data-action=\\\"edit-journal\\\"]\").click()");
        waitUntil("document.getElementById('journal-form')!==null");
        runJs("document.getElementById('journal-form').elements.content.value='內容已修改'");
        runJs("document.querySelector(\"#journal-form [data-action=\\\"save-form\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        runJs("document.querySelector(\".upcoming-row\").click()");
        waitUntil("document.querySelector('[data-action=delete-journal]')!==null");
        runJs("document.querySelector(\"[data-action=\\\"delete-journal\\\"]\").click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector(\"[data-action=\\\"confirm-cancel\\\"]\").click()");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).journal.length===2)"));
        runJs("document.querySelector(\"[data-action=\\\"close-sheet\\\"]\").click()");
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"settings\\\"]\").click()");
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"aurora\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='aurora'");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).settings.theme==='aurora')"));
        screenshot("v120-theme-aurora");
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"neon\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='neon'");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).settings.theme==='neon')"));
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"electric\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='electric'");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).settings.theme==='electric')"));
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"lava\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='lava'");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).settings.theme==='lava')"));
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"ice\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='ice'");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).settings.theme==='ice')"));
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"obsidian\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='obsidian'");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).settings.theme==='obsidian')"));
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"rainbow\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='rainbow'");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).settings.theme==='rainbow')"));
        screenshot("v120-theme-rainbow");
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"black\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='black'");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).settings.theme==='black')"));
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"rainbow\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='rainbow'");
        runJs("document.querySelector(\"[data-action=\\\"edit-title-settings\\\"]\").click()");
        waitUntil("document.getElementById('title-settings-form')!==null");
        runJs("var f=document.getElementById('title-settings-form');f.querySelector('[name=titleColorMode][value=custom]').checked=true;f.elements.titleColor.value='#a123d0';f.elements.subtitleColor.value='#137449'");
        runJs("document.querySelector(\"#title-settings-form [data-action=\\\"save-form\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("Boolean(getComputedStyle(document.querySelector('.brand h1')).color==='rgb(161, 35, 208)'&&Number(getComputedStyle(document.querySelector('.brand p')).fontWeight)>=700)"));
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"aurora\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='aurora'");
        assertEquals("true", evaluate("Boolean(getComputedStyle(document.querySelector('.brand h1')).color==='rgb(161, 35, 208)')"));
        runJs("document.querySelector(\"[data-action=\\\"edit-tag-style\\\"]\").click()");
        waitUntil("document.getElementById('tag-style-form')!==null");
        runJs("var f=document.getElementById('tag-style-form');f.querySelector('[name=style][value=custom]').checked=true;f.elements.customColor.value='#c28cff'");
        runJs("document.querySelector(\"#tag-style-form [data-action=\\\"save-form\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("Boolean(getComputedStyle(document.querySelector('.tag-settings-row .tag')).backgroundColor==='rgb(194, 140, 255)')"));
        runJs("document.querySelector(\"[data-action=\\\"edit-title-settings\\\"]\").click()");
        waitUntil("document.getElementById('title-settings-form')!==null");
        runJs("document.querySelector('[name=titleColorMode][value=theme]').checked=true");
        runJs("document.querySelector(\"#title-settings-form [data-action=\\\"save-form\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        runJs("var s=JSON.parse(AndroidBridge.loadState()),d=RenjiLogic.createDemoState();s.people=d.people;s.events=d.events;s.loans=d.loans;for(var i=0;i<7;i++){s.journal.push({id:'summary_'+i,kind:'todo',title:'近期計畫 '+(i+1),content:'待辦驗收',date:'2026-09-16',dueAt:new Date(Date.now()+(i+2)*3600000).toISOString(),completed:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})}window.__testBackup=s");
        importTestBackup();
        runJs("window.__beforeReload=true;location.reload()");
        waitUntil("window.__beforeReload!==true&&document.querySelectorAll('.nav-label').length===5");
        waitUntil("document.querySelectorAll('.upcoming-row').length===5");
        assertEquals("true", evaluate("Boolean(document.documentElement.dataset.theme==='aurora')"));
        assertEquals("true", evaluate("Boolean(getComputedStyle(document.querySelector('.quick-tags .tag-filter')).backgroundColor==='rgb(194, 140, 255)')"));
        screenshot("v120-people-aurora");
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"journal\\\"]\").click()");
        screenshot("v120-journal-aurora");
        runJs("Array.from(document.querySelectorAll('.journal-open')).find(function(e){return e.innerText.indexOf('咖啡靈感')>=0}).click()");
        waitUntil("document.querySelector('[data-action=delete-journal]')!==null");
        runJs("document.querySelector(\"[data-action=\\\"delete-journal\\\"]\").click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector(\"[data-action=\\\"confirm-accept\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("Boolean(!JSON.parse(AndroidBridge.loadState()).journal.some(function(x){return x.title==='咖啡靈感'}))"));
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"loans\\\"]\").click()");
        runJs("document.querySelector(\"[data-action=\\\"show-loan\\\"]\").click()");
        waitUntil("document.querySelector('.transaction-item')!==null");
        assertEquals("true", evaluate("Boolean(document.querySelector('[data-action=waive-loan]')===null)"));
        pressVisibleElement(".transaction-item h4", 900);
        waitUntil("document.querySelector('.sheet-title').innerText==='還款／歸還紀錄'");
        android.os.SystemClock.sleep(850);
        screenshot("v120-repayment-longpress");
        runJs("document.querySelector(\"[data-action=\\\"edit-transaction\\\"]\").click()");
        waitUntil("document.getElementById('transaction-form')!==null");
        runJs("document.getElementById('transaction-form').elements.value.value='2500'");
        runJs("document.querySelector(\"#transaction-form [data-action=\\\"save-form\\\"]\").click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector(\"[data-action=\\\"confirm-accept\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("Boolean(RenjiLogic.personScore(JSON.parse(AndroidBridge.loadState()),'demo_wang')===58&&JSON.parse(AndroidBridge.loadState()).loans[0].transactions[0].amount===2500)"));
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"events\\\"]\").click()");
        runJs("document.querySelector(\"[data-action=\\\"primary-add\\\"]\").click()");
        waitUntil("document.getElementById('event-form')!==null");
        runJs("var f=document.getElementById('event-form');f.elements.title.value='照片全圖驗收';f.elements.deltaAmount.value='0';var files=[0,1].map(function(i){return new File(['<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"1000\"><rect width=\"400\" height=\"1000\" fill=\"'+(i?'#b3ccec':'#d0b5d9')+'\"/><circle cx=\"200\" cy=\"500\" r=\"120\" fill=\"white\"/></svg>'],'完整照片'+i+'.svg',{type:'image/svg+xml'})});if(typeof DataTransfer==='function'){var dt=new DataTransfer();files.forEach(function(file){dt.items.add(file)});f.elements.attachments.files=dt.files}else{Object.defineProperty(f.elements.attachments,'files',{value:files})}");
        runJs("document.querySelector(\"#event-form [data-action=\\\"save-form\\\"]\").click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("Boolean(JSON.parse(AndroidBridge.loadState()).events.some(function(e){return e.title==='照片全圖驗收'&&e.attachments.length===2&&e.attachments[0].originalDataUrl.indexOf('data:image/svg+xml')===0}))"));
        runJs("Array.from(document.querySelectorAll('.event-card')).find(function(x){return x.innerText.indexOf('照片全圖驗收')>=0}).click()");
        waitUntil("document.querySelectorAll('.attachment-grid button').length===2");
        runJs("document.querySelector(\".attachment-grid button\").click()");
        waitUntil("document.getElementById('photo-viewer').open");
        assertEquals("true", evaluate("Boolean(document.querySelectorAll('.gallery-scroll figure').length===2)"));
        waitUntil("document.querySelector('.gallery-scroll').scrollHeight>document.querySelector('.gallery-scroll').clientHeight");
        screenshot("v120-photo-gallery");
        runJs("document.querySelector('.gallery-scroll').scrollTop=500");
        assertEquals("true", evaluate("Boolean(document.querySelector('.gallery-scroll').scrollTop>100)"));
        assertEquals("true", evaluate("Boolean(RenjiApp.handleBack())"));
        assertEquals("true", evaluate("Boolean(!document.getElementById('photo-viewer').open&&document.getElementById('sheet').open)"));
        runJs("document.querySelector(\"[data-action=\\\"close-sheet\\\"]\").click()");
        tapVisibleElement("[data-role=brand-title]");
        waitUntil("document.querySelector('[data-role=brand-title]').getAttribute('aria-label').indexOf('停止')>=0");
        tapVisibleElement("[data-role=brand-title]");
        waitUntil("document.querySelector('[data-role=brand-title]').getAttribute('aria-label').indexOf('點擊播放')>=0");
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"settings\\\"]\").click()");
        runJs("document.querySelector(\"[data-action=\\\"set-theme\\\"][data-theme=\\\"rainbow\\\"]\").click()");
        waitUntil("document.documentElement.dataset.theme==='rainbow'");
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"people\\\"]\").click()");
        screenshot("v120-people-rainbow");
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"journal\\\"]\").click()");
        screenshot("v120-journal-rainbow");
        runJs("document.querySelector(\"[data-action=\\\"nav\\\"][data-view=\\\"settings\\\"]\").click()");
        runJs("document.querySelector(\"[data-action=\\\"clear-all\\\"]\").click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector(\"[data-action=\\\"confirm-accept\\\"]\").click()");
        waitUntil("!document.getElementById('confirm-dialog').open");
    }

    @Test
    public void multiplePhotoUrisAreReturnedToWebView() {
        AtomicReference<Uri[]> result = new AtomicReference<>();
        activityRule.getScenario().onActivity(activity -> {
            Uri first = Uri.parse("content://test/photo-one");
            Uri second = Uri.parse("content://test/photo-two");
            ClipData clip = new ClipData("photos", new String[]{"image/jpeg"}, new ClipData.Item(first));
            clip.addItem(new ClipData.Item(second));
            Intent intent = new Intent();
            intent.setClipData(clip);
            result.set(activity.collectSelectedUris(Activity.RESULT_OK, intent));
        });
        assertNotNull(result.get());
        assertEquals(2, result.get().length);
    }
}
