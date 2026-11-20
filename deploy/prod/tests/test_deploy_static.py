"""Static production deployment checks; no services or root access required."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

PROD = Path(__file__).resolve().parents[1]
REPO = PROD.parents[1]
SCRIPTS = sorted(PROD.rglob("*.sh"))


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda path: path.name)
def test_shell_syntax_and_lf(script):
    assert b"\r" not in script.read_bytes(), f"CR found in {script}"
    bash = shutil.which("bash")
    assert bash, "bash is required (Git Bash on Windows or bash on Linux)"
    result = subprocess.run(
        [bash, "-n", script.as_posix()], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    assert "set -euo pipefail" in script.read_text(encoding="utf-8")


def test_acl_matches_dev():
    # Ignore checkout EOL conversion: dev may use CRLF on Windows, prod must use LF.
    assert (PROD / "mosquitto/acl.conf").read_text(encoding="utf-8") == (
        REPO / "deploy/dev/mosquitto/acl.conf"
    ).read_text(encoding="utf-8")


def test_nginx_client_address_and_body_limit():
    config = (PROD / "nginx/nfc-server.conf").read_text(encoding="utf-8")
    assert re.search(r"proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;", config)
    assert "$proxy_add_x_forwarded_for" not in config
    assert "client_max_body_size 3m;" in config


def test_service_user_and_sudo_compatibility():
    unit = (PROD / "nfc-server.service").read_text(encoding="utf-8")
    directives = "\n".join(
        line for line in unit.splitlines() if not line.startswith("#")
    )
    assert "User=nfcsrv" in directives
    assert not re.search(
        r"NoNewPrivileges\s*=\s*(yes|true|1)\b", directives, re.IGNORECASE
    )
    assert "CapabilityBoundingSet=" not in directives
    assert "ReadWritePaths=/var/lib/nfc-server" in directives


def test_pki_writes_are_guarded():
    script = (PROD / "init-pki.sh").read_text(encoding="utf-8")
    # Every output (including temporary CSRs/extensions) goes through one guarded
    # noclobber writer. OpenSSL's -out / CA serial database would bypass it.
    writer = re.search(r"write_new\(\) \{(.*?)\n\}", script, re.DOTALL)
    assert writer
    assert "[[ ! -e $target && ! -L $target ]]" in writer.group(1)
    assert (
        '(set -o noclobber; printf \'%s\\n\' "$content" > "$target")' in writer.group(1)
    )
    remainder = script[: writer.start()] + script[writer.end() :]
    remainder = re.sub(r'"[^"\n]*"|\x27[^\x27\n]*\x27', '""', remainder)
    remainder = remainder.replace(">&2", "")
    assert not re.search(
        r"(?<![<>])>(?![>&])|\btee\b|\s-out\b|\s-CAcreateserial\b", remainder
    )
    for output in (
        '"$KEYS_DIR/ca.key"',
        '"$KEYS_DIR/ca.crt"',
        '"$base.key"',
        '"$base.crt"',
        '"$WORK/request.csr"',
        '"$WORK/extensions"',
    ):
        assert f"write_new {output}" in script


def test_migration_precedes_activation_and_crl_precedes_broker():
    script = (PROD / "install-server.sh").read_text(encoding="utf-8")
    assert script.index("dist/infra/database/migrate-cli.js up") < script.index(
        'ln -sfn "$RELEASE" /opt/nfc-server/current'
    )
    assert (
        script.index("systemctl start nfc-server\ndeadline=")
        < script.index("until [[ -s $CRL_FILE ]]")
        < script.index("systemctl restart mosquitto\n")
    )


def test_crl_path_and_permissions_agree():
    script = (PROD / "install-server.sh").read_text(encoding="utf-8")
    broker = (PROD / "mosquitto/nfc.conf").read_text(encoding="utf-8")
    unit = (PROD / "nfc-server.service").read_text(encoding="utf-8")
    crl = re.search(r"^CRL_FILE=(.+)$", script, re.MULTILINE).group(1)
    assert crl == "/var/lib/nfc-server-crl/crl.pem"
    assert not crl.startswith("/var/lib/nfc-server/")
    assert re.search(r"^crlfile (.+)$", broker, re.MULTILINE).group(1) == crl
    writable = re.search(r"^ReadWritePaths=(.+)$", unit, re.MULTILINE).group(1).split()
    assert writable == ["/var/lib/nfc-server", str(Path(crl).parent).replace("\\", "/")]
    assert "install -d -o nfcsrv -g nfcsrv -m 0750 /var/lib/nfc-server\n" in script
    assert "install -d -o nfcsrv -g mosquitto -m 0750 /var/lib/nfc-server-crl\n" in script
    assert script.index('runuser -u mosquitto -- test -r "$CRL_FILE"') < script.index(
        "systemctl restart mosquitto\n"
    )


def test_cleanup_stops_before_restoring_and_checks_health():
    script = (PROD / "install-server.sh").read_text(encoding="utf-8")
    cleanup = re.search(r"cleanup\(\) \{(.*?)\n\}", script, re.DOTALL).group(1)
    assert (
        cleanup.index("systemctl stop nfc-server")
        < cleanup.index('ln -sfn "$OLD_RELEASE" /opt/nfc-server/current')
        < cleanup.index("systemctl start nfc-server")
        < cleanup.index('wait_for_health "$OLD_RELEASE"')
    )
    assert 'wait_for_health "$RELEASE"' in script
    assert "local release=$1 deadline=$((SECONDS + 60))" in script
    assert "nfc-server has been left stopped" in cleanup


def test_release_copy_is_published_only_when_complete():
    script = (PROD / "install-server.sh").read_text(encoding="utf-8")
    copy = re.search(
        r"if \[\[ ! -f \$RELEASE/\.complete \]\]; then\n(.*?)\nfi",
        script,
        re.DOTALL,
    ).group(1)
    assert (
        copy.index('rm -rf -- "$RELEASE"')
        < copy.index('mktemp -d "/opt/nfc-server/releases/.$VERSION.partial-XXXX"')
        < copy.index('cp -a "${roots[0]}/." "$PARTIAL/"')
        < copy.index('chown -R root:root "$PARTIAL"')
        < copy.index('chmod -R a+rX "$PARTIAL"')
        < copy.index('touch "$PARTIAL/.complete"')
        < copy.index('mv -- "$PARTIAL" "$RELEASE"')
    )
    assert "-type d ! -name '.*'" in script
