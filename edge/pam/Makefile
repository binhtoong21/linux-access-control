# Build: make            (needs libpam0g-dev)
# Install: sudo make install   -> /lib/x86_64-linux-gnu/security/pam_nfc.so (Ubuntu multiarch path)
CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra -Werror -fPIC -fstack-protector-strong -D_FORTIFY_SOURCE=2
LDFLAGS ?= -shared -Wl,-z,relro,-z,now
PAMDIR ?= /lib/x86_64-linux-gnu/security

pam_nfc.so: pam_nfc.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $< -lpam

install: pam_nfc.so
	install -m 0644 -o root -g root pam_nfc.so $(PAMDIR)/pam_nfc.so

clean:
	rm -f pam_nfc.so

.PHONY: install clean
