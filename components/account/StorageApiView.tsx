'use client'

import { Icon } from '@/components/site/Icons'
import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { api, type RetentionRule, type S3Overview } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { storageApiMessages } from '@/lib/i18n/messages/storage-api'
import { formatBytes } from '@/lib/vault'

type Bucket = S3Overview['buckets'][number]

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="small" type="button" onClick={() => void navigator.clipboard?.writeText(value).then(() => setDone(true))}>
      {done ? '✓' : label}
    </button>
  )
}

/** Speicher-API (Business): Endpoint, Zugangsschlüssel, Buckets mit Object Lock und Aufbewahrung. */
export default function StorageApiView() {
  const m = useMessages(storageApiMessages)
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const [ov, setOv] = useState<S3Overview | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState<{ accessKey: string; secretKey: string } | null>(null)
  const [bucket, setBucket] = useState('')
  const [lock, setLock] = useState(false)
  const [revoke, setRevoke] = useState<{ key: string; label: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(() => api.s3Overview().then(setOv).catch(e => setMsg({ ok: false, text: errText(e) })), [errText])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null)
    try {
      await fn()
      await load()
      if (ok) setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
    }
  }

  if (!ov) return msg ? <div className="errorbox">{msg.text}</div> : <div className="card">…</div>

  const k = secret?.accessKey ?? '<ACCESS_KEY>'
  const sk = secret?.secretKey ?? '<SECRET_KEY>'
  const b = ov.buckets[0]?.name ?? 'backups'
  const snippets: Array<[string, string]> = [
    ['restic', `export AWS_ACCESS_KEY_ID=${k}\nexport AWS_SECRET_ACCESS_KEY=${sk}\nrestic -r s3:${ov.endpoint}/${b}/restic init\nrestic -r s3:${ov.endpoint}/${b}/restic backup /var/lib/data`],
    ['pgBackRest', `repo1-type=s3\nrepo1-s3-endpoint=${ov.endpoint.replace(/^https?:\/\//, '')}\nrepo1-s3-bucket=${b}\nrepo1-s3-region=${ov.region}\nrepo1-s3-uri-style=path\nrepo1-s3-key=${k}\nrepo1-s3-key-secret=${sk}\nrepo1-cipher-type=aes-256-cbc`],
    ['WAL-G', `export WALG_S3_PREFIX=s3://${b}/wal-g\nexport AWS_ENDPOINT=${ov.endpoint}\nexport AWS_S3_FORCE_PATH_STYLE=true\nexport AWS_ACCESS_KEY_ID=${k}\nexport AWS_SECRET_ACCESS_KEY=${sk}\nexport WALG_LIBSODIUM_KEY=$(openssl rand -hex 32)`],
    ['rclone', `rclone config create focvault s3 provider=Other endpoint=${ov.endpoint} access_key_id=${k} secret_access_key=${sk} force_path_style=true`],
    ['Proxmox / Veeam / Synology', `# S3-kompatibles Ziel („S3 compatible“ / „Other“) anlegen:\nEndpoint:    ${ov.endpoint}\nRegion:      ${ov.region}\nAccess Key:  ${k}\nSecret Key:  ${sk}\nBucket:      ${b}\nPfad-Stil:   ja (path-style)`]
  ]

  return (
    <>
      <div className="apimods">
        {(
          [
            ['database', m.modS3, m.modS3Sub, 'ok', m.stActive],
            ['terminal', m.modCli, m.modCliSub, 'ok', m.stAvailable],
            ['activity', m.modHooks, m.modHooksSub, '', m.stSoon],
            ['sso', m.modSso, m.modSsoSub, 'blue', 'Enterprise']
          ] as const
        ).map(([i, t, d, cls, st], n) => (
          <div className={`apimod${n === 0 ? ' on' : ''}`} key={t}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="pwavatar">
                <Icon name={i} size={18} />
              </span>
              <span className={`badge ${cls}`}>{st}</span>
            </div>
            <strong>{t}</strong>
            <span className="hint">{d}</span>
          </div>
        ))}
      </div>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      <div className="card">
        <h3>{m.title}</h3>
        <p className="dim">{m.lead}</p>
        <div className="stat">
          <span className="k">{m.endpoint}</span>
          <span className="v row">
            <span className="mono">{ov.endpoint}</span> <Copy value={ov.endpoint} label={m.copy} />
          </span>
        </div>
        <div className="stat">
          <span className="k">{m.region}</span>
          <span className="v mono">{ov.region}</span>
        </div>
        <div className="stat">
          <span className="k">{m.style}</span>
          <span className="v">{m.pathStyle}</span>
        </div>
      </div>

      <div className="card">
        <h3>
          {m.keys} <span>{ov.keys.length}</span>
        </h3>
        <p className="dim">{m.keysLead}</p>
        {secret && (
          <div className="sharelink">
            <strong>{m.secretOnce}</strong>
            <div className="row">
              <span className="dim">{m.accessKey}</span> <span className="mono">{secret.accessKey}</span> <Copy value={secret.accessKey} label={m.copy} />
            </div>
            <div className="row">
              <span className="dim">{m.secretKey}</span> <span className="mono">{secret.secretKey}</span> <Copy value={secret.secretKey} label={m.copy} />
            </div>
          </div>
        )}
        <div className="trashlist">
          {ov.keys.length === 0 && <span className="hint">{m.noKeys}</span>}
          {ov.keys.map(key => (
            <div className="trashrow" key={key.accessKey}>
              <div className="trashinfo">
                <strong>{key.label}</strong>
                <span className="hint mono">
                  {key.accessKey} · {key.lastUsedAt ? fmt(m.lastUsed, { date: fmtDate(key.lastUsedAt) }) : m.neverUsed}
                </span>
              </div>
              <button className="small danger" onClick={() => setRevoke({ key: key.accessKey, label: key.label })}>
                {m.revoke}
              </button>
            </div>
          ))}
        </div>
        <form
          className="row"
          style={{ marginTop: 12 }}
          onSubmit={e => {
            e.preventDefault()
            void run(async () => setSecret(await api.s3CreateKey(label || m.keyLabelPlaceholder)))
            setLabel('')
          }}
        >
          <input aria-label={m.keyLabel} placeholder={m.keyLabelPlaceholder} value={label} onChange={e => setLabel(e.target.value)} style={{ maxWidth: 260 }} />
          <button className="primary small" type="submit">
            + {m.createKey}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>
          {m.buckets} <span>{ov.buckets.length}</span>
        </h3>
        <div className="trashlist">
          {ov.buckets.length === 0 && <span className="hint">{m.noBuckets}</span>}
          {ov.buckets.map(bk => (
            <BucketRow key={bk.name} bucket={bk} editing={editing === bk.name} onEdit={() => setEditing(editing === bk.name ? null : bk.name)} onSaved={async () => { setEditing(null); await load(); setMsg({ ok: true, text: m.saved }) }} onError={t => setMsg({ ok: false, text: t })} />
          ))}
        </div>
        <form
          className="row"
          style={{ marginTop: 12 }}
          onSubmit={e => {
            e.preventDefault()
            void run(() => api.s3CreateBucket(bucket.trim(), lock))
            setBucket('')
            setLock(false)
          }}
        >
          <input aria-label={m.bucketName} placeholder={m.bucketNamePlaceholder} value={bucket} onChange={e => setBucket(e.target.value.toLowerCase())} style={{ maxWidth: 260 }} />
          <label className="checkline" style={{ margin: 0 }}>
            <input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} />
            <span>{m.objectLock}</span>
          </label>
          <button className="primary small" type="submit" disabled={!bucket.trim()}>
            + {m.createBucket}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>{m.quickstart}</h3>
        <p className="dim">{m.quickstartLead}</p>
        {snippets.map(([name, code]) => (
          <details key={name} className="snippet">
            <summary>{name}</summary>
            <pre className="previewtext">{code}</pre>
            <Copy value={code} label={m.copy} />
          </details>
        ))}
      </div>

      {revoke && (
        <ConfirmDialog
          title={fmt(m.confirmRevoke, { name: revoke.label })}
          body={m.confirmRevokeBody}
          confirmLabel={m.revoke}
          cancelLabel={m.cancel}
          onCancel={() => setRevoke(null)}
          onConfirm={() => {
            const r = revoke
            setRevoke(null)
            void run(() => api.s3RevokeKey(r.key))
          }}
        />
      )}
    </>
  )
}

function BucketRow({ bucket, editing, onEdit, onSaved, onError }: { bucket: Bucket; editing: boolean; onEdit: () => void; onSaved: () => Promise<void>; onError: (t: string) => void }) {
  const m = useMessages(storageApiMessages)
  const errText = useErrorText()
  const r = bucket.retention
  const [mode, setMode] = useState<'' | 'GOVERNANCE' | 'COMPLIANCE'>(bucket.lock?.mode ?? '')
  const [days, setDays] = useState(bucket.lock?.days ?? 30)
  const [rule, setRule] = useState<RetentionRule>(r ?? { prefix: '', keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepYearly: 0 })
  const [useRule, setUseRule] = useState(!!r)

  const save = async () => {
    try {
      await api.s3UpdateBucket(bucket.name, {
        ...(bucket.objectLock ? { lock: mode ? { mode, days } : null } : {}),
        retention: useRule ? rule : null
      })
      await onSaved()
    } catch (e) {
      onError(errText(e))
    }
  }

  const num = (k: keyof RetentionRule, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} value={rule[k] as number} onChange={e => setRule({ ...rule, [k]: Number(e.target.value) })} />
    </label>
  )

  return (
    <div className="trashrow bucketrow">
      <div className="trashinfo">
        <strong>
          <Icon name="bucket" size={16} className="inlineicon" /> {bucket.name} {bucket.objectLock && <span className="badge ok">Object Lock</span>}
        </strong>
        <span className="hint">
          {fmt(m.objects, { n: bucket.objects, size: formatBytes(bucket.bytes) })} · {fmt(m.onFilecoin, { n: bucket.onFilecoin, total: bucket.objects })}
        </span>
        <span className="hint">
          {bucket.objectLock ? (bucket.lock ? fmt(m.lockOn, { mode: bucket.lock.mode, days: bucket.lock.days }) : m.lockNone) : m.lockOff} · {m.retention}:{' '}
          {r ? fmt(m.retentionSummary, { prefix: r.prefix ? `${r.prefix}: ` : '', d: r.keepDaily, w: r.keepWeekly, m: r.keepMonthly, y: r.keepYearly }) : m.retentionOff}
        </span>
      </div>
      <button className="small" onClick={onEdit}>
        {editing ? m.cancel : m.edit}
      </button>
      {editing && (
        <div className="bucketedit">
          {bucket.objectLock && (
            <div className="formgrid">
              <label className="field">
                <span>{m.lockMode}</span>
                <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
                  <option value="">{m.noLock}</option>
                  <option value="GOVERNANCE">{m.governance}</option>
                  <option value="COMPLIANCE">{m.compliance}</option>
                </select>
              </label>
              <label className="field">
                <span>{m.lockDays}</span>
                <input type="number" min={1} value={days} disabled={!mode} onChange={e => setDays(Number(e.target.value))} />
              </label>
            </div>
          )}
          <label className="checkline">
            <input type="checkbox" checked={useRule} onChange={e => setUseRule(e.target.checked)} />
            <span>{m.retention}</span>
          </label>
          {useRule && (
            <>
              <p className="hint">{m.retentionLead}</p>
              <div className="formgrid">
                <label className="field">
                  <span>{m.prefix}</span>
                  <input value={rule.prefix} onChange={e => setRule({ ...rule, prefix: e.target.value })} />
                </label>
                {num('keepDaily', m.keepDaily)}
                {num('keepWeekly', m.keepWeekly)}
                {num('keepMonthly', m.keepMonthly)}
                {num('keepYearly', m.keepYearly)}
              </div>
            </>
          )}
          <button className="primary small" onClick={() => void save()}>
            {m.save}
          </button>
        </div>
      )}
    </div>
  )
}
