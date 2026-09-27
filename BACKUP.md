# Backup-Programm & S3-Gateway

Beides läuft **auf deinem Gerät** und verschlüsselt dort – exakt wie der Browser (Argon2id → Master-Key,
AES-256-GCM pro Datei). FocVault und Filecoin sehen nur Ciphertext. Gespeichert wird nur der
Session-Cookie in `~/.focvault/config.json` (Rechte 0600) – nie Passphrase oder Schlüssel.

## Installieren
```bash
npm install --legacy-peer-deps
npm run build:cli            # erzeugt bin/focvault.mjs (Node ≥ 20)
alias focvault="node $PWD/bin/focvault.mjs"
```

## Backup
```bash
focvault login --server https://focvault.app --email du@example.com
focvault backup ~/Dokumente --name Laptop       # inkrementell: nur neue/geänderte Dateien
focvault backup ~/Dokumente --name Laptop --dry-run
focvault ls
focvault restore ~/Wiederhergestellt --prefix Laptop/
```
- Geänderte Dateien werden bei Pro/Family zur **neuen Version**, die bisherige bleibt erhalten.
- Erkennung über Größe + Änderungszeit, pro Gerät und Ordner.
- Automatisch jede Nacht (Cron/launchd): `0 3 * * * FOCVAULT_PASSPHRASE=… focvault backup ~/Dokumente`
  (Passphrase dann in einem Schlüsselbund/Secret-Store ablegen, nicht im Klartext in der Crontab).
- Wiederherstellen schreibt atomar (`.part` → umbenennen) und lässt keine Pfade außerhalb des Ziels zu.

## S3-Gateway
```bash
focvault s3 --port 9000
```
Zeigt Endpoint, Access Key und Secret. Nur auf `127.0.0.1` erreichbar.

| Programm | Einstellung |
|---|---|
| rclone | `rclone config create focvault s3 provider=Other endpoint=http://127.0.0.1:9000 access_key_id=… secret_access_key=… force_path_style=true` |
| AWS CLI | `aws --endpoint-url http://127.0.0.1:9000 s3 sync ./fotos s3://fotos` |
| Cyberduck | „S3 (HTTP)“, Server `127.0.0.1`, Port 9000, Access/Secret Key |
| Synology/QNAP Hyper Backup | „S3-kompatibel“, Endpoint wie oben, Pfad-Stil |

Unterstützt: Buckets, ListObjects v1/v2 (Präfix, Ordner, Seiten), Put/Get (Range)/Head/Delete,
Mehrfach-Löschen, Kopieren, Multipart-Upload, signierte Links (SigV4). Objekte erscheinen im
Dashboard unter „Backups & Mehr“ als `S3/<bucket>/<key>` und werden wie alle Dateien auf Filecoin gesichert.
Nicht unterstützt: Objekt-Versionierung über die S3-API (Versionen gibt es im Dashboard), ACLs,
Lifecycle-Regeln, Chunk-Signaturen von `aws-chunked` (der Header-Signatur wird vertraut).
