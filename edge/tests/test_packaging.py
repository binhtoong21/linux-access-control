"""Exercise package PAM edits against the Ubuntu 22.04 LightDM configuration."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

EDGE = Path(__file__).resolve().parents[1]
PACKAGING = EDGE / "packaging"
HELPER = PACKAGING / "debian" / "nfc-pam-config"
BASH = shutil.which("bash")
pytestmark = pytest.mark.skipif(BASH is None, reason="bash is not on PATH; package shell tests require bash")
MARKER = "# nfc-agent: card login (managed by package nfc-agent)\n"
MANAGED = "auth    sufficient    pam_nfc.so\n"
LEGACY = "auth    sufficient    /lib/security/pam_nfc.so\n"
STOCK = """#%PAM-1.0
auth    requisite       pam_nologin.so
auth    sufficient      pam_succeed_if.so user ingroup nopasswdlogin
@include common-auth
-auth    optional        pam_gnome_keyring.so
-auth    optional        pam_kwallet.so
-auth    optional        pam_kwallet5.so
@include common-account
session [success=ok ignore=ignore module_unknown=ignore default=bad] pam_selinux.so close
#session required        pam_loginuid.so
session required        pam_limits.so
@include common-session
session [success=ok ignore=ignore module_unknown=ignore default=bad] pam_selinux.so open
-session optional        pam_gnome_keyring.so auto_start
-session optional        pam_kwallet.so auto_start
-session optional        pam_kwallet5.so auto_start
session required        pam_env.so readenv=1
session required        pam_env.so readenv=1 user_readenv=1 envfile=/etc/default/locale
@include common-password
"""


def run_bash(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([BASH, *args], capture_output=True, text=True, check=True)


@pytest.fixture
def pam_file(tmp_path: Path) -> Path:
    path = tmp_path / "lightdm"
    path.write_bytes(STOCK.encode())
    return path


def edit(action: str, path: Path) -> subprocess.CompletedProcess[str]:
    return run_bash(HELPER.as_posix(), action, path.as_posix())


def expected_managed() -> bytes:
    return STOCK.replace("@include common-auth\n", MARKER + MANAGED + "@include common-auth\n").encode()


def test_add_preserves_other_lines_and_is_idempotent(pam_file: Path):
    edit("add", pam_file)
    assert pam_file.read_bytes() == expected_managed()
    edit("add", pam_file)
    assert pam_file.read_bytes() == expected_managed()


@pytest.mark.parametrize("legacy", [LEGACY, LEGACY.replace("/lib/security/", "/lib/x86_64-linux-gnu/security/")])
def test_add_replaces_manual_absolute_path(pam_file: Path, legacy: str):
    pam_file.write_bytes(STOCK.replace("@include common-auth\n", legacy + "@include common-auth\n").encode())
    edit("add", pam_file)
    assert pam_file.read_bytes() == expected_managed()
    edit("add", pam_file)
    assert pam_file.read_bytes() == expected_managed()


def test_remove_restores_original_and_is_idempotent(pam_file: Path):
    edit("add", pam_file)
    edit("remove", pam_file)
    assert pam_file.read_bytes() == STOCK.encode()
    edit("remove", pam_file)
    assert pam_file.read_bytes() == STOCK.encode()


def test_remove_without_managed_line_is_noop(pam_file: Path):
    edit("remove", pam_file)
    assert pam_file.read_bytes() == STOCK.encode()


def test_missing_common_auth_warns_without_editing(pam_file: Path):
    content = STOCK.replace("@include common-auth\n", LEGACY).encode()
    pam_file.write_bytes(content)
    result = edit("add", pam_file)
    assert pam_file.read_bytes() == content
    assert "warning" in result.stderr
    assert "no @include common-auth" in result.stderr


@pytest.mark.skipif(os.name == "nt", reason="Windows filesystems do not expose POSIX mode 0644")
def test_file_mode_preserved(pam_file: Path):
    pam_file.chmod(0o644)
    edit("add", pam_file)
    assert pam_file.stat().st_mode & 0o777 == 0o644
    edit("remove", pam_file)
    assert pam_file.stat().st_mode & 0o777 == 0o644


def test_greeter_selection_is_a_vendor_config():
    build_script = (PACKAGING / "build-deb.sh").read_text(encoding="utf-8")
    assert (
        'install -Dm644 "$PACKAGING/99-lab-greeter.conf" "$ROOT/usr/share/lightdm/lightdm.conf.d/99-lab-greeter.conf"'
    ) in build_script
    assert "$ROOT/etc/lightdm/" not in build_script
    conffiles = (PACKAGING / "debian" / "conffiles").read_text(encoding="utf-8")
    assert "lightdm" not in conffiles
    assert conffiles.splitlines() == ["/etc/modprobe.d/blacklist-nfc-pn533.conf"]


SHELL_FILES = [
    PACKAGING / "build-deb.sh",
    PACKAGING / "nfc-agent",
    *(PACKAGING / "debian" / name for name in ("postinst", "prerm", "postrm", "nfc-pam-config")),
    EDGE / "greeter" / "lab-greeter-wrapper.sh",
]


@pytest.mark.parametrize("path", SHELL_FILES, ids=lambda path: path.name)
def test_shell_syntax_and_lf(path: Path):
    assert b"\r" not in path.read_bytes()
    run_bash("-n", path.as_posix())
