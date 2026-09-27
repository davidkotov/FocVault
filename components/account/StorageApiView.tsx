'use client'

import { Icon } from '@/components/site/Icons'
import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { api, type RetentionRule, type S3Overview } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { storageApiMessages } from '@/lib/i18n/messages/storage-api'
import { formatBytes } from '@/lib/vault'
import { createPortal } from 'react-dom'
import { relativeDay } from '@/lib/i18n/relative'

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
  const { path, locale } = useI18n()
  const errText = useErrorText()
  const [ov, setOv] = useState<S3Overview | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState<{ accessKey: string; secretKey: string } | null>(null)
  const [bucket, setBucket] = useState('')
  const [lock, setLock] = useState(false)
  const [revoke, setRevoke] = useState<{ key: string; label: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [snip, setSnip] = useState(0)
  const [showForm, setShowForm] = useState<'key' | 'bucket' | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('pageactions-slot')), [])

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

  const totalBytes = ov.buckets.reduce((n, x) => n + x.bytes, 0)
  const totalObjects = ov.buckets.reduce((n, x) => n + x.objects, 0)
  const onFc = ov.buckets.reduce((n, x) => n + x.onFilecoin, 0)
  const [snipName, snipCode] = snippets[snip] ?? snippets[0]
  const shortKey = (key: string) => (key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key)
  const protection = (bk: Bucket) =>
    bk.lock ? (
      <span className="badge dark">
        {bk.lock.mode === 'COMPLIANCE' ? 'Compliance' : 'Governance'} · {bk.lock.days} T.
      </span>
    ) : bk.retention ? (
      <span className="badge">
        GFS {bk.retention.keepDaily}/{bk.retention.keepWeekly}/{bk.retention.keepMonthly}
      </span>
    ) : (
      <span className="dim">—</span>
    )

  return (
    <>
      {slot && createPortal(
        <a className="button small" href={path('/docs')}>
          {m.docs}
        </a>,
        slot
      )}
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

      <div className="apisechead">
        <div>
          <h2>{m.title}</h2>
          <p className="dim">{m.sectionLead}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="small" onClick={() => setShowForm(f => (f === 'bucket' ? null : 'bucket'))}>
            + {m.bucketShort}
          </button>
          <button className="primary small" onClick={() => setShowForm(f => (f === 'key' ? null : 'key'))}>
            <Icon name="key" size={14} /> {m.createKeyLong}
          </button>
        </div>
      </div>

      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}

      {secret && (
        <div className="card sharelink secretonce">
          <strong>{m.secretOnce}</strong>
          <div className="row">
            <span className="dim">{m.accessKey}</span> <span className="mono">{secret.accessKey}</span> <Copy value={secret.accessKey} label={m.copy} />
          </div>
          <div className="row">
            <span className="dim">{m.secretKey}</span> <span className="mono">{secret.secretKey}</span> <Copy value={secret.secretKey} label={m.copy} />
          </div>
        </div>
      )}

      {showForm === 'key' && (
        <form
          className="card row apiform"
          onSubmit={e => {
            e.preventDefault()
            void run(async () => setSecret(await api.s3CreateKey(label || m.keyLabelPlaceholder)))
            setLabel('')
            setShowForm(null)
          }}
        >
          <span className="dim">{m.keysLead}</span>
          <input aria-label={m.keyLabel} placeholder={m.keyLabelPlaceholder} value={label} onChange={e => setLabel(e.target.value)} style={{ maxWidth: 260 }} autoFocus />
          <button className="primary small" type="submit">
            {m.createKey}
          </button>
        </form>
      )}
      {showForm === 'bucket' && (
        <form
          className="card row apiform"
          onSubmit={e => {
            e.preventDefault()
            void run(() => api.s3CreateBucket(bucket.trim(), lock))
            setBucket('')
            setLock(false)
            setShowForm(null)
          }}
        >
          <input aria-label={m.bucketName} placeholder={m.bucketNamePlaceholder} value={bucket} onChange={e => setBucket(e.target.value.toLowerCase())} style={{ maxWidth: 260 }} autoFocus />
          <label className="checkline" style={{ margin: 0 }}>
            <input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} />
            <span>{m.objectLock}</span>
          </label>
          <button className="primary small" type="submit" disabled={!bucket.trim()}>
            {m.createBucket}
          </button>
        </form>
      )}

      <div className="plangrid2 apigrid">
        <div className="card apiendpoint">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="dim">{m.endpoint}</span>
            <span className="badge">{m.euData}</span>
          </div>
          <div className="apiep">
            <span className="mono">{ov.endpoint}</span>
            <Copy value={ov.endpoint} label={m.copy} />
            <span className="dim">
              {m.region} <span className="mono">{ov.region}</span> · {m.pathStyle}
            </span>
          </div>
          <div className="snipTabs" role="tablist" aria-label={m.quickstart}>
            {snippets.map(([name], i) => (
              <button key={name} role="tab" aria-selected={snip === i} className={snip === i ? 'active' : ''} onClick={() => setSnip(i)}>
                {name}
              </button>
            ))}
          </div>
          <pre className="apicode" aria-label={snipName}>
            {snipCode}
          </pre>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="hint">{m.quickstartLead}</span>
            <Copy value={snipCode} label={m.copy} />
          </div>
        </div>

        <div className="card plansection">
          <div className="plansection-head">
            <h3>{m.usage}</h3>
            <span className="dim">{fmt(m.fcShare, { pct: totalObjects ? Math.round((onFc / totalObjects) * 100) : 100 })}</span>
          </div>
          <div className="apiusage">
            <div className="apiusage-total">
              <b>{formatBytes(totalBytes)}</b>
              <span className="dim">{fmt(m.usageSub, { b: ov.buckets.length, o: totalObjects.toLocaleString() })}</span>
            </div>
            {ov.buckets.map(bk => (
              <div className="apiusage-row" key={bk.name}>
                <span>{bk.name}</span>
                <div className="planbar">
                  <b style={{ width: `${totalBytes ? Math.max(2, (bk.bytes / totalBytes) * 100) : 0}%`, background: '#0b1220' }} />
                </div>
                <span className="dim">{formatBytes(bk.bytes)}</span>
              </div>
            ))}
            {ov.buckets.length === 0 && <p className="dim">{m.noBuckets}</p>}
          </div>
        </div>
      </div>

      <div className="plangrid2 apigrid">
        <div className="card plansection">
          <div className="plansection-head">
            <h3>{m.buckets}</h3>
            <span className="dim">{m.bucketsHint}</span>
          </div>
          <table className="plantable">
            <thead>
              <tr>
                <th>{m.colBucket}</th>
                <th>{m.colSize}</th>
                <th>{m.colProtection}</th>
                <th>Filecoin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ov.buckets.map(bk => (
                <tr key={bk.name}>
                  <td>
                    <span className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'nowrap' }}>
                      <span className="pwavatar small">
                        <Icon name="bucket" size={15} />
                      </span>
                      <b>{bk.name}</b>
                    </span>
                  </td>
                  <td>{formatBytes(bk.bytes)}</td>
                  <td>{protection(bk)}</td>
                  <td>
                    <span className={`strongbadge${bk.objects && bk.onFilecoin < bk.objects ? ' info' : ''}`}>{bk.objects ? Math.round((bk.onFilecoin / bk.objects) * 100) : 100} %</span>
                  </td>
                  <td className="act">
                    <button className="small" onClick={() => setEditing(editing === bk.name ? null : bk.name)}>
                      {editing === bk.name ? m.cancel : m.edit}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ov.buckets.length === 0 && <p className="dim" style={{ padding: '12px 18px' }}>{m.noBuckets}</p>}
          {ov.buckets
            .filter(bk => bk.name === editing)
            .map(bk => (
              <BucketRow key={bk.name} bucket={bk} editing panelOnly onEdit={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); setMsg({ ok: true, text: m.saved }) }} onError={t => setMsg({ ok: false, text: t })} />
            ))}
        </div>

        <div className="card plansection">
          <div className="plansection-head">
            <h3>{m.keys}</h3>
            <span className="dim">{m.secretOnceShort}</span>
          </div>
          <table className="plantable">
            <thead>
              <tr>
                <th>{m.colName}</th>
                <th>{m.colAccessKey}</th>
                <th>{m.colLastUsed}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ov.keys.map(key => (
                <tr key={key.accessKey}>
                  <td>
                    <b>{key.label}</b>
                  </td>
                  <td className="mono" title={key.accessKey}>
                    {shortKey(key.accessKey)}
                  </td>
                  <td className="dim">{key.lastUsedAt ? relativeDay(new Date(key.lastUsedAt).getTime(), locale) : m.neverUsed}</td>
                  <td className="act">
                    <button className="linkish dangerlink" onClick={() => setRevoke({ key: key.accessKey, label: key.label })}>
                      {m.revoke}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ov.keys.length === 0 && <p className="dim" style={{ padding: '12px 18px' }}>{m.noKeys}</p>}
        </div>
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


function BucketRow({ bucket, editing, onEdit, onSaved, onError, panelOnly }: { bucket: Bucket; editing: boolean; onEdit: () => void; onSaved: () => Promise<void>; onError: (t: string) => void; panelOnly?: boolean }) {
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

  if (panelOnly)
    return (
      <div className="bucketpanel">
        <b>{bucket.name}</b>
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
      </div>
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
