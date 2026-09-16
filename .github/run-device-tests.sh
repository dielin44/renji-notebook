#!/usr/bin/env bash
set +e
gradle --no-daemon :app:connectedDebugAndroidTest
test_result=$?
adb pull /data/local/tmp/renji-qa qa-artifacts
exit "$test_result"
