# Deploying to web01 (operandis.co.za)

Operandis runs on **web01**, the same server as AirHouse and WeShip, and is deployed the same way:

```
Internet ─► host nginx + Let's Encrypt (operandis.co.za)
              └─► 127.0.0.1:5100 ─► "operandis" container (website + API)
                                        └─► "operandis-db" container (private PostgreSQL 16)
/srv/operandis            git checkout (like /srv/airhouse)
/srv/operandis/deploy/.env.production   secrets (chmod 600, never committed)
/srv/backups/operandis    database dumps (before every deploy + nightly)
```

Nothing here touches the other apps: Operandis has its own containers, its own database container and volumes, a port bound to localhost only, and its own nginx site file. The deploy script refuses to start if its port is already taken.

The deploy kit was exercised end to end with Docker before merging: image build, first deploy, migrations, seeding, owner account, health-gated switch-over, `--status`, `--backup`, a second release and `--rollback`.

You'll type everything below into **Windows PowerShell**, inside an SSH session to web01.

---

## 1. Point the domain at web01

At your domain registrar, create (or update) two DNS records pointing to **web01's public IP** — the same IP `airhouse.co.za` uses:

| Type | Name | Value |
| --- | --- | --- |
| A | `operandis.co.za` (or `@`) | web01 IP |
| A | `www` | web01 IP |

Check from PowerShell on your PC:

```powershell
Resolve-DnsName operandis.co.za
```

```powershell
Resolve-DnsName airhouse.co.za
```

Both should show the same IP before you do step 6.

## 2. Connect to web01

```powershell
ssh root@web01
```

(Use the same host/IP and login you use for AirHouse, e.g. `ssh root@<web01-ip>`.)

## 3. Get the code

The repository is public, so no GitHub login is needed:

```bash
git clone https://github.com/WeDeliver01/operandis.git /srv/operandis
```

(If you make the repository private later, give web01 read access the same way `/srv/airhouse` pulls, e.g. a read-only deploy key, and switch the remote with `git remote set-url origin git@github.com:WeDeliver01/operandis.git`.)

```bash
cd /srv/operandis
```

## 4. Create the production settings

```bash
cp deploy/.env.production.example deploy/.env.production && chmod 600 deploy/.env.production
```

Fill in the two generated secrets automatically:

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|; s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=')|" deploy/.env.production
```

Check the port is free (AirHouse uses 5000; Operandis defaults to **5100**). This should print nothing:

```bash
ss -ltn | grep ':5100 '
```

If it prints a line, choose another port (e.g. 5110) for `APP_PORT` in the next step and in the nginx file in step 6.

Now add your email (SMTP) details — **required**, the app won't start in production without them. If AirHouse already sends with Resend, reuse it: add and verify the `operandis.co.za` domain in Resend first, then use `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=resend`, `SMTP_PASSWORD=<a Resend API key>`.

```bash
nano deploy/.env.production
```

Save with `Ctrl+O`, `Enter`; exit with `Ctrl+X`. Keep one setting per line and put comments on their own lines (the deploy script checks this). PayFast details can be added later — EFT works without them.

## 5. First deploy

```bash
./deploy/deploy.sh
```

It builds the image (a few minutes the first time), starts the database, backs it up, applies migrations, starts the app and waits until it's healthy. The last check ("Verifying through nginx") will warn until step 6 is done — that's expected.

Load the site content (portfolio, services, FAQs, packages). Packages and pricing start as **drafts** until you approve real prices in the console:

```bash
docker exec operandis node dist/seed.mjs
```

> Want to see the full shop working while you review? Use `docker exec operandis node dist/seed.mjs --demo` instead: it publishes packages with **placeholder prices**, clearly labelled "demonstration pricing". Replace them before launch.

Create your owner account — it prints a one-time link (valid 7 days) to set your password:

```bash
docker exec operandis node dist/create-admin.mjs --email you@operandis.co.za --name "Your Name"
```

## 6. HTTPS certificate + nginx

Two things about web01's nginx shape this step:

- It only loads site files whose names end in **`.conf`**. A file named plain `operandis.co.za` is silently ignored.
- `certbot --nginx` (install mode) writes the certificate into the shared **`default.conf`** when it can't find our site, which broke nginx's config on the first install. So use `certonly`, which only fetches the certificate and never edits nginx files, then install our own site file, which already points at the certificate.

Get the certificate (once DNS from step 1 resolves):

```bash
certbot certonly --nginx -d operandis.co.za -d www.operandis.co.za
```

Install the site:

```bash
cp deploy/operandis.co.za.conf /etc/nginx/sites-available/operandis.co.za.conf
```

```bash
ln -sf /etc/nginx/sites-available/operandis.co.za.conf /etc/nginx/sites-enabled/operandis.co.za.conf
```

```bash
nginx -t && systemctl reload nginx
```

`nginx -t` must say *syntax is ok* and *test is successful* before you reload — it checks every site on web01, so a mistake here can't take AirHouse down unnoticed.

Check that automatic renewal will work (a rehearsal; it changes nothing):

```bash
certbot renew --cert-name operandis.co.za --dry-run
```

Confirm end to end:

```bash
./deploy/deploy.sh --status
```

```bash
curl -s https://operandis.co.za/api/v1/ready
```

Open **https://operandis.co.za**, then the password link from step 5, and sign in at **https://operandis.co.za/admin**.

## 7. Background jobs and nightly backups

```bash
cp deploy/operandis-cron /etc/cron.d/operandis && chmod 644 /etc/cron.d/operandis
```

This sends queued emails every 5 minutes, expires abandoned checkouts and proposals, deletes expired configurator drafts, and takes a nightly database dump into `/srv/backups/operandis` (newest 30 kept). Include that folder in whatever off-server backup you use for AirHouse, along with `deploy/.env.production`.

## 8. First-time setup in the console

1. **Settings → Business** — legal name, registration number, contact emails (`hello@` / `legal@operandis.co.za` once the mailboxes exist), staff alert emails, Cal.com link.
2. **Settings → Security** — require two-factor authentication for staff, then enrol your authenticator app.
3. **Settings → Commerce** — enable EFT and/or PayFast, enter bank details, terms version and refund summary.
4. **Settings → Tax** — leave off until your accountant confirms VAT.
5. **Pricing rules** — create your real rate card and approve it. **Packages** — set prices and publish.
6. **PayFast** — add credentials to `deploy/.env.production` (sandbox first), run `./deploy/deploy.sh`, do a test purchase, check **Payments → Webhook log**, then switch to `PAYFAST_MODE=live` with live credentials and deploy again.

Full list of business decisions: `docs/owner-decisions.md`.

## Day-to-day

Deploy the latest `main` (same rhythm as AirHouse):

```bash
cd /srv/operandis && git pull && ./deploy/deploy.sh
```

| Task | Command |
| --- | --- |
| What's running + health | `./deploy/deploy.sh --status` |
| Roll back to the previous release | `./deploy/deploy.sh --rollback` |
| Backup now | `./deploy/deploy.sh --backup` |
| Live logs | `docker logs -f operandis` (Ctrl+C to exit) |
| Run maintenance jobs now | `docker exec operandis node dist/jobs.mjs` |
| Another staff account | `docker exec operandis node dist/create-admin.mjs --email … --name "…" --role staff` |
| Download a backup to your PC (run in PowerShell on your PC) | `scp root@web01:/srv/backups/operandis/<file>.dump .` |

Restore a backup (stops the site briefly):

```bash
docker stop operandis && docker exec -i operandis-db pg_restore -U operandis -d operandis --clean --if-exists < /srv/backups/operandis/<file>.dump && docker start operandis
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `deploy.sh` stops with "Missing required settings" or a line-number error | Fix that line in `deploy/.env.production` (one `KEY=value` per line, comments on their own line) |
| "Port 5100 is already used by another service" | Choose a free `APP_PORT` and use the same port in `/etc/nginx/sites-available/operandis.co.za.conf` |
| `nginx -t`: *no "ssl_certificate" is defined for the "listen ... quic" directive in default.conf* | `certbot --nginx` edited `default.conf`. Undo it with `certbot rollback --checkpoints 1` (the certificate is kept), remove any `operandis.co.za` server block from `default.conf`, then follow step 6 |
| https://operandis.co.za shows another site or a default page | The site file must end in `.conf` (step 6), and `default.conf` must not contain a `server_name … operandis.co.za` block: `grep -rn "operandis.co.za;" /etc/nginx/sites-enabled/` |
| Container not healthy | `docker logs operandis --tail 100` — the app prints exactly which setting is invalid |
| 502 from nginx | `./deploy/deploy.sh --status`; `proxy_pass` port must equal `APP_PORT` |
| certbot fails | DNS not pointing at web01 yet (`Resolve-DnsName operandis.co.za`) |
| Emails not sending | Console → Email log shows the error; check SMTP settings and domain verification |
| Emails/webhooks fail with DNS errors | Containers use pinned DNS (1.1.1.1) because of the Tailscale resolver issue seen on WeShip; check outbound DNS/firewall |
| Payments stay "confirming" | Console → Payments → Webhook log; PayFast must reach `https://operandis.co.za/api/v1/webhooks/payments/payfast` |
