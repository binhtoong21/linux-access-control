#!/usr/bin/env python3
"""Lab Custom Greeter (ADR-005 §3–5): waits for the agent's push events and logs the shared profile in.

Runs as user `lightdm` under LightDM, started through lab-greeter-wrapper.sh. Holds no business logic: the agent
decides; the greeter shows the result and drives LightDM. Password fallback is for technicians (D-007.2).
"""

import json
import signal
import socket
import sys
import threading
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("LightDM", "1")
from gi.repository import GLib, Gtk, LightDM  # noqa: E402

PUSH_SOCK = "/run/nfc/greeter-push.sock"
STARTUP_HANDSHAKE = 1.2  # seconds before greeter_ready (ADR-005 §4, S6/S7)
MESSAGE_SECONDS = 4.0

DENY_TEXT = {  # ADR-005 §3, same reason codes as CR-001
    "unknown_card": "Thẻ chưa có trong dữ liệu của máy này!",
    "card_disabled": "Thẻ đã bị vô hiệu hóa hoặc báo mất!",
    "user_inactive": "Tài khoản đang bị tạm khóa!",
    "no_schedule": "Bạn không có lịch sử dụng máy này!",
    "out_of_schedule": "Bạn không có ca học hợp lệ trong khung giờ này!",
    "ambiguous_profile": "Lịch học bị xung đột môi trường máy trạm!",
    "profile_disabled": "Môi trường học tập (profile OS) đang tạm đóng!",
    "profile_not_found": "Không tìm thấy cấu hình môi trường máy trạm!",
    "workstation_busy": "Máy đang có phiên của người khác chưa hết giờ!",
    "already_active": "Bạn đang trong phiên làm việc của mình!",
    "data_stale": "Dữ liệu phòng lab tạm thời quá hạn. Vui lòng báo Kỹ thuật viên!",
    "invalid_uid": "Không đọc được thẻ, vui lòng quẹt lại!",
    "reader_error": "Không đọc được thẻ, vui lòng quẹt lại!",
    "internal_error": "Máy trạm gặp lỗi, vui lòng báo Kỹ thuật viên!",
}
IDLE = "Vui lòng quẹt thẻ để đăng nhập"


class LabGreeter(Gtk.Window):
    def __init__(self):
        super().__init__(title="Phòng Lab")
        self.fullscreen()
        box = Gtk.Box(
            orientation=Gtk.Orientation.VERTICAL, spacing=12, halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER
        )
        title = Gtk.Label()
        title.set_markup("<span size='xx-large' weight='bold'>PHÒNG MÁY</span>")
        self.status = Gtk.Label()
        self._show(IDLE)
        self.user_entry = Gtk.Entry(placeholder_text="Tài khoản bảo trì")
        self.pass_entry = Gtk.Entry(placeholder_text="Mật khẩu", visibility=False)
        self.pass_entry.connect("activate", self.on_fallback)
        button = Gtk.Button(label="Đăng nhập bảo trì")
        button.connect("clicked", self.on_fallback)
        for w in (title, self.status, self.user_entry, self.pass_entry, button):
            box.pack_start(w, False, False, 4)
        self.add(box)

        self.greeter = LightDM.Greeter()
        self.greeter.connect("show-prompt", self.on_prompt)
        self.greeter.connect("authentication-complete", self.on_auth_complete)
        self.greeter.connect_to_daemon_sync()
        self.session_key = self._pick_session()
        self.fallback = False
        self._reset_id = None
        threading.Thread(target=self._ipc_loop, daemon=True).start()

    # ---------------------------------------------------------------- UI
    def _show(self, text, color=None):
        color_attr = f" foreground='{color}'" if color else ""
        self.status.set_markup(f"<span size='x-large'{color_attr}>{GLib.markup_escape_text(text)}</span>")

    def _flash(self, text, color):
        self._show(text, color)
        if self._reset_id:
            GLib.source_remove(self._reset_id)
        self._reset_id = GLib.timeout_add(int(MESSAGE_SECONDS * 1000), self._back_to_idle)

    def _back_to_idle(self):
        self._reset_id = None
        self._show(IDLE)
        return False

    @staticmethod
    def _pick_session():
        keys = [s.get_key() for s in LightDM.get_sessions()]
        return next((k for k in ("ubuntu", "ubuntu-xorg", "gnome") if k in keys), keys[0] if keys else "ubuntu")

    # ---------------------------------------------------------------- agent events
    def _ipc_loop(self):
        time.sleep(STARTUP_HANDSHAKE)
        while True:
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                    s.connect(PUSH_SOCK)
                    s.sendall(b'{"action": "greeter_ready"}\n')
                    buf = b""
                    while chunk := s.recv(4096):
                        buf += chunk
                        while b"\n" in buf:
                            line, buf = buf.split(b"\n", 1)
                            if line.strip():
                                GLib.idle_add(self._on_event, json.loads(line))
            except (OSError, ValueError):
                time.sleep(0.5)  # agent not up yet or restarted: keep trying, fallback stays usable

    def _on_event(self, ev):
        kind = ev.get("event")
        if kind == "card_granted":
            self._flash(f"Xin chào {ev.get('display_name', '')}! Đang vào Desktop…", "#15803d")
            self.fallback = False
            if self.greeter.get_in_authentication():
                self.greeter.cancel_authentication()
            self.greeter.authenticate(ev["os_username"])
        elif kind == "card_denied":
            self._flash(DENY_TEXT.get(ev.get("reason"), "Không thể đăng nhập."), "#b91c1c")
        elif kind == "teardown_wait":
            self._show("Đang dọn dẹp phiên trước, vui lòng chờ trong giây lát…", "#a16207")
        elif kind == "teardown_failed":
            self._flash("Máy trạm gặp sự cố giải phóng tài nguyên. Vui lòng liên hệ Kỹ thuật viên!", "#b91c1c")
        elif kind == "status":
            self._show(ev.get("text", IDLE))
        return False

    # ---------------------------------------------------------------- LightDM
    def on_fallback(self, _widget):
        user = self.user_entry.get_text().strip()
        if not user:
            return
        self.fallback = True
        if self.greeter.get_in_authentication():
            self.greeter.cancel_authentication()
        self.greeter.authenticate(user)

    def on_prompt(self, greeter, _text, _prompt_type):
        # Card logins are already authorized by pam_nfc.so; only the technician fallback types a password.
        greeter.respond(self.pass_entry.get_text() if self.fallback else "")

    def on_auth_complete(self, greeter):
        if greeter.get_is_authenticated():
            greeter.start_session_sync(self.session_key)
        else:
            self.pass_entry.set_text("")
            self._flash("Xác thực thất bại!", "#b91c1c")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # clean exit 0 when LightDM hands over (S10)
    win = LabGreeter()
    win.connect("destroy", Gtk.main_quit)
    win.show_all()
    Gtk.main()
