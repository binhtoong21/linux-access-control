/*
 * pam_nfc.so - asks the NFC Edge Agent whether the current login was granted by a card swipe (ADR-005 §2).
 *
 * Stateless and fail-safe: any error, missing socket or timeout returns PAM_IGNORE so the stack falls through
 * to pam_unix (password fallback for technicians, BR-004). Proven in S2 (fallback in ~22 ms when the agent is down).
 *
 * Protocol on /run/nfc-agent.sock (0660 root:root, agent checks SO_PEERCRED uid 0):
 *   -> "AUTH <PAM_USER>\n"
 *   <- "GRANTED <os_username>\n"  |  "DENIED <reason>\n"
 */
#define _GNU_SOURCE
#include <poll.h>
#include <security/pam_ext.h>
#include <security/pam_modules.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <syslog.h>
#include <unistd.h>

#define SOCKET_PATH "/run/nfc-agent.sock"
#define TIMEOUT_MS 3000
#define MAX_USER 32

static int valid_username(const char *s, size_t n) {
    if (n == 0 || n > MAX_USER) return 0;
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return 0;
    }
    return 1;
}

static int ask_agent(const char *pam_user, char *granted_user, size_t cap) {
    int sock = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (sock < 0) return 0;

    struct sockaddr_un addr = {.sun_family = AF_UNIX};
    strncpy(addr.sun_path, SOCKET_PATH, sizeof(addr.sun_path) - 1);
    if (connect(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) goto fail;

    char req[64];
    int len = snprintf(req, sizeof(req), "AUTH %s\n", pam_user ? pam_user : "");
    if (len <= 0 || (size_t)len >= sizeof(req) || write(sock, req, (size_t)len) != len) goto fail;

    struct pollfd pfd = {.fd = sock, .events = POLLIN};
    if (poll(&pfd, 1, TIMEOUT_MS) <= 0) goto fail;

    char buf[128];
    ssize_t n = read(sock, buf, sizeof(buf) - 1);
    close(sock);
    if (n <= 0) return 0;
    buf[n] = '\0';

    if (strncmp(buf, "GRANTED ", 8) != 0) return 0;
    char *user = buf + 8;
    size_t ulen = strcspn(user, "\r\n");
    if (!valid_username(user, ulen) || ulen >= cap) return 0;
    memcpy(granted_user, user, ulen);
    granted_user[ulen] = '\0';
    return 1;

fail:
    close(sock);
    return 0;
}

PAM_EXTERN int pam_sm_authenticate(pam_handle_t *pamh, int flags, int argc, const char **argv) {
    (void)flags; (void)argc; (void)argv;
    const char *pam_user = NULL;
    if (pam_get_item(pamh, PAM_USER, (const void **)&pam_user) != PAM_SUCCESS) pam_user = NULL;
    if (pam_user && !valid_username(pam_user, strlen(pam_user))) return PAM_IGNORE;

    char granted[MAX_USER + 1];
    if (!ask_agent(pam_user, granted, sizeof(granted))) return PAM_IGNORE;

    /* The agent only grants the profile it resolved; never switch to a different user silently. */
    if (pam_user && *pam_user && strcmp(pam_user, granted) != 0) return PAM_IGNORE;
    if (!pam_user || !*pam_user) pam_set_item(pamh, PAM_USER, granted);
    pam_syslog(pamh, LOG_INFO, "NFC login granted for %s", granted);
    return PAM_SUCCESS;
}

PAM_EXTERN int pam_sm_setcred(pam_handle_t *pamh, int flags, int argc, const char **argv) {
    (void)pamh; (void)flags; (void)argc; (void)argv;
    return PAM_SUCCESS;
}
