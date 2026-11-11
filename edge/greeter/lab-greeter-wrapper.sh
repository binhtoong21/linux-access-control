#!/bin/bash
CRASH_LOG="/var/lib/lightdm/lab-greeter-crashes"
NOW=$(date +%s)
# Đếm số lần crash trong vòng 60 giây gần nhất
if [ -f "$CRASH_LOG" ]; then
    RECENT_CRASHES=$(awk -v now="$NOW" '$1 > now - 60' "$CRASH_LOG" | wc -l)
else
    RECENT_CRASHES=0
fi

if [ "$RECENT_CRASHES" -ge 3 ]; then
    echo "Lab Greeter crash liên tiếp 3 lần trong 60s! Kích hoạt fallback đồ họa..."
    exec /usr/sbin/lightdm-gtk-greeter
fi

# Chạy nền để bắt exit code. LightDM gửi SIGTERM cho chính wrapper (PID nó khởi chạy),
# nên wrapper phải chuyển tiếp tín hiệu cho greeter, nếu không greeter thành tiến trình mồ côi.
python3 /usr/local/bin/lab_greeter.py &
CHILD=$!
trap 'kill -TERM "$CHILD" 2>/dev/null' TERM INT
wait "$CHILD"; EXIT_CODE=$?
# wait bị ngắt bởi tín hiệu (mã > 128) thì chờ greeter thoát hẳn để lấy mã thật
if [ "$EXIT_CODE" -gt 128 ]; then wait "$CHILD"; EXIT_CODE=$?; fi
if [ "$EXIT_CODE" -eq 0 ]; then
    rm -f "$CRASH_LOG"
    exit 0
fi

echo "$NOW" >> "$CRASH_LOG"
exit "$EXIT_CODE"
