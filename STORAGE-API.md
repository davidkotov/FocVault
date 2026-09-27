# Speicher-API (S3) – Business

S3-kompatibler Speicher für Server-, Datenbank- und NAS-Backups. Die Backup-Werkzeuge verschlüsseln
selbst (restic, pgBackRest `repo1-cipher-type`, WAL-G `WALG_LIBSODIUM_KEY`, Proxmox, Veeam); FocVault
speichert die Objekte wie alle Dateien: Quota, Abrechnung, Sicherung auf Filecoin mit Speicherbeweisen.

## Für Kunden (Dashboard → „Speicher-API“)
- **Zugangsschlüssel** pro Server/Werkzeug, Secret wird nur einmal angezeigt, jederzeit widerrufbar.
- **Buckets** – optional **unlöschbar (Object Lock)**, nur beim Anlegen wählbar:
  - *GOVERNANCE*: mit `x-amz-bypass-governance-retention` aufhebbar,
  - *COMPLIANCE*: von niemandem aufhebbar oder verkürzbar, nur verlängerbar (Schutz gegen Erpressungs-Software).
  - Standardfrist je Bucket oder Frist je Objekt (`x-amz-object-lock-*`, `PutObjectRetention`).
- **Aufbewahrungsregeln** (Großvater-Vater-Sohn): je Tag/Woche/Monat/Jahr das neueste Backup behalten,
  z. B. täglich 30, monatlich 12. Jünger als 24 h bleibt immer; gesperrte Objekte bleiben bis Fristende.
- **Filecoin**: Anzeige „n von m auf Filecoin gesichert“ je Bucket.

## Unterstützte S3-Operationen
ListBuckets, Create/Delete/HeadBucket, GetBucketLocation, Get/PutObjectLockConfiguration,
ListObjects v1/v2 (Präfix, Trennzeichen, Seiten), Put/Get (Range)/Head/DeleteObject, DeleteObjects,
CopyObject, Multipart (Create/UploadPart/Complete/Abort, bis 10 000 Teile à 5 GiB), Get/PutObjectRetention,
SigV4 (Header und signierte Links), `aws-chunked`-Uploads der AWS-SDKs.
Nicht: Objekt-Versionierung, ACLs/Bucket-Policies, Lifecycle-XML (dafür die Aufbewahrungsregeln).

## Technik
- Uploads werden **direkt** in 32-MiB-Teile gestreamt – keine Zwischendatei, beliebig groß.
- Objekte liegen in `objects`/`object_pieces` (fmt `s3`), Metadaten in `s3_objects` (Migration v13).
- Laufende Multipart-Uploads zählen zur Quota; nach 7 Tagen werden sie abgebrochen (Wartung).

## Betrieb
- Lokal startet die API automatisch mit dem Dev-Server auf `http://127.0.0.1:9000`.
- Production: eigener Node-Prozess (nicht Vercel) mit `S3_API_PORT=9000`, `S3_API_HOST=0.0.0.0`,
  dahinter TLS-Proxy (z. B. `https://s3.focvault.app`) und `S3_PUBLIC_URL=https://s3.focvault.app`.
- Preise: Preisbuch → „Speicher-API“ (Standard 1.5 Rp/GB/Monat).
