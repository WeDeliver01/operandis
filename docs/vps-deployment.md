# Deploying to a VPS (operandis.co.za)

This guide installs the whole platform — website, client portal, console and API — on a single Ubuntu server, served at **https://operandis.co.za** by nginx with a free Let's Encrypt certificate. Written for **Ubuntu 24.04 LTS** (22.04 works the same). You run every command from **Windows PowerShell** over SSH.

What ends up on the server:

```
nginx (443, TLS) ──► Node.js app on 127.0.0.1:8080 (systemd: operandis) ──► PostgreSQL (local)
                                                       └─ private files: /srv/operandis/files
systemd timer: operandis-jobs (every 5 min) · nightly database backup (cron)
```

---

## 0. Before you start

1. **DNS** — at your domain registrar, create two records pointing at the VPS's public IPv4 address:
   - `A` record `operandis.co.za` → `YOUR.SERVER.IP`
   - `A` record `www.operandis.co.za` → `YOUR.SERVER.IP`

   Changes can take a few minutes to an hour. Check from PowerShell: `Resolve-DnsName operandis.co.za`.
2. **SSH access** — your VPS provider gives you a root password or lets you upload an SSH key.
3. **Have ready**: SMTP details from your email provider (for sending mail from `hello@operandis.co.za`), and PayFast sandbox/live merchant credentials (you can add these later).

## 1. Connect from PowerShell

Windows 10/11 include an SSH client. Open **PowerShell** and run:

```powershell
ssh root@YOUR.SERVER.IP
```

Type `yes` the first time, then your password. Every command below runs **on the server** inside this SSH session.

> Tip: to avoid passwords, create a key once on your PC with `ssh-keygen -t ed25519`, then copy it up with
> `type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@YOUR.SERVER.IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"`

## 2. Base packages, firewall, Node.js and pnpm

```bash
apt update && apt -y upgrade
```

```bash
apt -y install curl git nginx postgresql postgresql-contrib certbot python3-certbot-nginx ufw
```

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt -y install nodejs
```

```bash
npm install -g pnpm@10.28.0 && node -v && pnpm -v
```

## 3. App user and folders

```bash
useradd --system --create-home --home-dir /srv/operandis --shell /bin/bash operandis
```

```bash
mkdir -p /srv/operandis/files /srv/operandis/backups && chown -R operandis:operandis /srv/operandis
```

## 4. Database

Generate a strong database password and keep it for step 6:

```bash
DBPASS=$(openssl rand -hex 24); echo "Database password: $DBPASS"
```

```bash
sudo -u postgres psql -c "CREATE ROLE operandis LOGIN PASSWORD '$DBPASS';" -c "CREATE DATABASE operandis OWNER operandis;"
```

PostgreSQL only listens on localhost by default — leave it that way.

## 5. Get the code (read-only deploy key)

The repository is private, so the server needs its own read-only key:

```bash
sudo -u operandis mkdir -p -m 700 /srv/operandis/.ssh
```

```bash
sudo -u operandis ssh-keygen -t ed25519 -N "" -f /srv/operandis/.ssh/id_ed25519 -C "operandis-vps"
```

```bash
cat /srv/operandis/.ssh/id_ed25519.pub
```

Copy the printed line. On GitHub open **WeDeliver01/operandis → Settings → Deploy keys → Add deploy key**, paste it, give it a title (e.g. `vps`), leave **Allow write access unticked**, and save. Then:

```bash
sudo -u operandis ssh -o StrictHostKeyChecking=accept-new -T git@github.com
```

(It prints "You've successfully authenticated… does not provide shell access" — that's correct.)

```bash
sudo -u operandis git clone git@github.com:WeDeliver01/operandis.git /srv/operandis/app
```

## 6. Production settings

```bash
cp /srv/operandis/app/deploy/operandis.env.example /srv/operandis/operandis.env
```

```bash
sed -i "s|CHANGE_ME_DB_PASSWORD|$DBPASS|; s|CHANGE_ME_TO_A_LONG_RANDOM_VALUE|$(openssl rand -base64 48 | tr -d '\n/+=')|" /srv/operandis/operandis.env
```

```bash
chown operandis:operandis /srv/operandis/operandis.env && chmod 600 /srv/operandis/operandis.env
```

Now edit the file to add your SMTP and PayFast details:

```bash
nano /srv/operandis/operandis.env
```

(Save with `Ctrl+O`, `Enter`; exit with `Ctrl+X`.) Every variable is explained in `docs/environment.md`. If you don't have SMTP details yet, put real values in later — the app refuses to start in production without an SMTP host, so use your provider's host now even if the password comes later.

## 7. Build, migrate, seed, create your owner account

```bash
cd /srv/operandis/app && sudo -u operandis pnpm install --frozen-lockfile
```

```bash
sudo -u operandis env PORT=5173 BASE_PATH=/ pnpm build
```

Load the settings into this shell session for the next commands:

```bash
set -a; source /srv/operandis/operandis.env; set +a; cd /srv/operandis/app/artifacts/api-server
```

```bash
sudo -E -u operandis node dist/migrate.mjs
```

Seed the content (portfolio, services, FAQs, packages). Choose **one**:

- Production (packages and pricing stay **drafts** until you approve real prices in the console):
  ```bash
  sudo -E -u operandis node dist/seed.mjs
  ```
- Review mode (publishes packages with the **placeholder demo prices**, clearly labelled "demonstration pricing"; use only while you review, then replace the prices):
  ```bash
  sudo -E -u operandis node dist/seed.mjs --demo
  ```

Create your owner account (prints a one-time link to set your password, valid 7 days):

```bash
sudo -E -u operandis node dist/create-admin.mjs --email you@operandis.co.za --name "Your Name"
```

## 8. Run it as a service

```bash
cp /srv/operandis/app/deploy/operandis.service /srv/operandis/app/deploy/operandis-jobs.service /srv/operandis/app/deploy/operandis-jobs.timer /etc/systemd/system/
```

```bash
systemctl daemon-reload && systemctl enable --now operandis operandis-jobs.timer
```

```bash
systemctl status operandis --no-pager && curl -s http://127.0.0.1:8080/api/v1/ready
```

You should see `"status":"ready"`. Logs: `journalctl -u operandis -f` (exit with `Ctrl+C`).

## 9. nginx and HTTPS

```bash
cp /srv/operandis/app/deploy/nginx-operandis.conf /etc/nginx/sites-available/operandis
```

```bash
ln -sf /etc/nginx/sites-available/operandis /etc/nginx/sites-enabled/operandis && rm -f /etc/nginx/sites-enabled/default
```

```bash
nginx -t && systemctl reload nginx
```

Once DNS points at the server, get the certificate (it also sets up the HTTPS redirect and auto-renewal):

```bash
certbot --nginx -d operandis.co.za -d www.operandis.co.za --redirect --agree-tos -m you@operandis.co.za --no-eff-email
```

Open **https://operandis.co.za** in your browser. Then open the link printed in step 7 to set your password and sign in at **https://operandis.co.za/admin**.

## 10. First-time configuration in the console

1. **Settings → Business** — trading/legal name, registration number, contact emails (`hello@operandis.co.za`, `legal@operandis.co.za` once the mailboxes exist), staff alert emails, Cal.com link.
2. **Settings → Security** — turn on *Require two-factor authentication for all staff*; enrol your authenticator.
3. **Settings → Commerce** — enable PayFast (credentials come from the env file) and/or EFT, set bank details, terms version and refund summary.
4. **Settings → Tax** — leave off until your accountant confirms VAT treatment.
5. **Pricing rules** — create a version with your real rate card and approve it.
6. **Packages** — set real prices and publish.
7. In PayFast's dashboard, no notify URL setup is needed (the app sends it per payment); make one low-value test purchase in sandbox mode, check **Payments → Webhook log**, then switch `PAYFAST_MODE=live` with live credentials in `/srv/operandis/operandis.env` and `systemctl restart operandis`.

See `docs/owner-decisions.md` for the full checklist.

## 11. Nightly backups

```bash
echo '15 2 * * * postgres pg_dump -Fc operandis > /srv/operandis/backups/nightly-$(date +\%a).dump' > /etc/cron.d/operandis-backup
```

This keeps a rolling 7 days of database dumps (`/srv/operandis/backups`); `update.sh` also takes one before every deploy. **Copy backups off the server** too (your VPS provider's snapshot feature, or `scp` them to another machine), together with `/srv/operandis/files` (uploaded documents) and `/srv/operandis/operandis.env`.

Download the latest backup to your PC from PowerShell (run on your PC, not in the SSH session):

```powershell
scp root@YOUR.SERVER.IP:/srv/operandis/backups/nightly-*.dump .
```

Restore (on the server, stops the app briefly):

```bash
systemctl stop operandis && sudo -u postgres pg_restore --clean --if-exists -d operandis /srv/operandis/backups/FILE.dump && systemctl start operandis
```

## 12. Deploying updates

After changes are merged to `main` on GitHub:

```bash
ssh root@YOUR.SERVER.IP
```

```bash
/srv/operandis/app/deploy/update.sh
```

It backs up the database, pulls `main`, installs, builds, migrates and restarts, then prints the readiness check. To roll back, re-run with an older commit: `sudo -u operandis git -C /srv/operandis/app reset --hard <commit>` and the build/migrate/restart lines from the script (migrations are additive), or restore a backup.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `502 Bad Gateway` | `systemctl status operandis` and `journalctl -u operandis -n 100` — usually a missing/invalid value in `operandis.env` (the app prints exactly which) |
| App won't start: "configure a real email driver" | Production requires `EMAIL_DRIVER=smtp` and `SMTP_HOST` |
| certbot fails | DNS not pointing at the server yet (`Resolve-DnsName operandis.co.za`), or port 80 blocked |
| Emails not arriving | Console → Email log shows errors; verify SMTP credentials and SPF/DKIM for operandis.co.za |
| Payments stay "confirming" | Console → Payments → Webhook log; PayFast must reach `https://operandis.co.za/api/v1/webhooks/payments/payfast` |
| Uploads fail | `/srv/operandis/files` must be owned by `operandis` |
