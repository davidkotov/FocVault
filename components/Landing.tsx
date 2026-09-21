'use client'

import { useConnect } from 'wagmi'
import { filecoinCalibration } from '@/lib/chains'

export default function Landing() {
  const { connect, connectors, isPending } = useConnect()
  const injected = connectors.find(c => c.id === 'injected')
  const walletConnectC = connectors.find(c => c.id === 'walletConnect')

  const handleConnect = () => {
    const connector = injected ?? walletConnectC
    if (connector) connect({ connector, chainId: filecoinCalibration.id })
  }

  return (
    <div>
      <div className="utilbar">
        <div className="wrap">
          <div>
            <a href="https://docs.filecoin.cloud" target="_blank" rel="noreferrer">
              Dokumentation
            </a>
            <a href="#sicherheit">Sicherheit</a>
            <a href="#faq">Support</a>
          </div>
          <div>
            <a href="#" onClick={e => { e.preventDefault(); handleConnect() }}>
              Anmelden
            </a>
          </div>
        </div>
      </div>

      <nav className="mainnav">
        <div className="wrap">
          <div className="brand">
            <svg className="mark" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="20" fill="#0090ff" />
              <path d="M20 8a12 12 0 1 0 8.49 3.51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
              <rect x="15" y="17" width="10" height="9" rx="2" fill="#fff" />
              <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2.4" fill="none" />
            </svg>
            Foc<span style={{ color: '#0090ff' }}>Vault</span>
          </div>
          <div className="navlinks">
            <a href="#produkt">Produkt</a>
            <a href="#sicherheit">Sicherheit</a>
            <a href="#preise">Preise</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="navcta">
            <button disabled={isPending} onClick={handleConnect}>
              Anmelden
            </button>
            <button className="primary" disabled={isPending} onClick={handleConnect}>
              {isPending ? 'Verbinde…' : 'Kostenlos starten'}
            </button>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
          <span className="pill">
            <b>NEU</b> Secure Send &amp; Mobile-Sync
          </span>
          <h1>
            Deine Privacy Cloud für
            <br />
            Dateien, Fotos &amp; mehr
          </h1>
          <p className="lead">
            Ende-zu-Ende-verschlüsselt in deinem Browser, dezentral gespeichert auf Filecoin.
            Niemand außer dir sieht deine Daten — nicht einmal wir.
          </p>
          <div className="herobtns">
            <button className="primary lg" disabled={isPending} onClick={handleConnect}>
              {isPending ? 'Verbinde…' : 'Kostenlos starten'}
            </button>
            <a href="#produkt">
              <button className="lg">Live-Demo ansehen</button>
            </a>
          </div>
          <div className="trustline">
            <b>20 MB kostenlos</b> · Kein Abo-Zwang · Keine Kreditkarte nötig
          </div>

          <div className="preview">
            <div className="barfake">
              <span className="fdot" />
              <span className="fdot" />
              <span className="fdot" />
              <span className="urlfake">app.focvault.io/cloud</span>
            </div>
            <div className="pvbody">
              <div className="pv-side">
                <div className="pv-navitem active">☁️ Meine Cloud</div>
                <div className="pv-navitem">🔗 Secure Send</div>
                <div className="pv-navitem">💳 Konto</div>
                <div className="pv-navitem" style={{ opacity: 0.4 }}>
                  🔐 Passwörter
                </div>
                <div className="pv-navitem" style={{ opacity: 0.4 }}>
                  📝 Notizen
                </div>
              </div>
              <div className="pv-main">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 15 }}>Meine Cloud</strong>
                  <span className="chip active" style={{ fontSize: 12 }}>
                    + Hochladen
                  </span>
                </div>
                <div style={{ marginTop: 14 }}>
                  <span className="chip active">Alle (12)</span>
                  <span className="chip" style={{ marginLeft: 8 }}>
                    📄 Dokumente
                  </span>
                  <span className="chip" style={{ marginLeft: 8 }}>
                    🖼️ Fotos
                  </span>
                </div>
                <div className="pv-grid">
                  <div className="pv-card">
                    <div className="pv-tile" style={{ background: 'var(--accent-soft)' }} />
                    <div className="pv-name">Vertrag.pdf</div>
                    <div className="pv-meta">1.2 MB · heute</div>
                  </div>
                  <div className="pv-card">
                    <div className="pv-tile" style={{ background: 'var(--red-soft)' }} />
                    <div className="pv-name">Urlaub_04.jpg</div>
                    <div className="pv-meta">4.8 MB · gestern</div>
                  </div>
                  <div className="pv-card">
                    <div className="pv-tile" style={{ background: 'var(--green-soft)' }} />
                    <div className="pv-name">Backup.zip</div>
                    <div className="pv-meta">220 MB · 3 Tage</div>
                  </div>
                  <div className="pv-card">
                    <div className="pv-tile" style={{ background: 'var(--yellow-soft)' }} />
                    <div className="pv-name">Notizen.txt</div>
                    <div className="pv-meta">4 KB · 1 Woche</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="trustbar">
        <div className="wrap">
          <span className="trustbadge">⛓️ Filecoin Onchain Cloud</span>
          <span className="trustbadge">✅ PDP-verifiziert</span>
          <span className="trustbadge">🔒 Zero-Knowledge</span>
          <span className="trustbadge">🧩 Open Source</span>
        </div>
      </div>

      <section className="msection" id="produkt">
        <div className="wrap">
          <div className="eyebrow">Produkt</div>
          <h2 className="sectitle">Eine Cloud. Volle Kontrolle.</h2>
          <p className="subtitle">
            Komfortable Oberfläche, dezentrale Infrastruktur darunter — du musst nie wissen,
            was technisch dahinter passiert.
          </p>
          <div className="features">
            <div className="feature">
              <div className="fi">
                <svg className="icon" viewBox="0 0 24 24">
                  <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <h3>Zero-Knowledge</h3>
              <p>AES-256-GCM-Verschlüsselung direkt im Browser. Schlüssel verlassen dein Gerät nie.</p>
            </div>
            <div className="feature">
              <div className="fi">
                <svg className="icon" viewBox="0 0 24 24">
                  <ellipse cx="12" cy="5" rx="8" ry="3" />
                  <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
                  <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
                </svg>
              </div>
              <h3>Dezentrale Speicherung</h3>
              <p>Filecoin Onchain Cloud, 2 Kopien bei unabhängigen Providern, PDP-verifiziert.</p>
            </div>
            <div className="feature">
              <div className="fi">
                <svg className="icon" viewBox="0 0 24 24">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="M8.6 10.6l6.8-3.2M8.6 13.4l6.8 3.2" />
                </svg>
              </div>
              <h3>Secure Send</h3>
              <p>Dateien teilen ohne Empfänger-Konto — Schlüssel im Link, nie auf dem Server.</p>
            </div>
            <div className="feature">
              <div className="fi">
                <svg className="icon" viewBox="0 0 24 24">
                  <rect x="3" y="6" width="18" height="13" rx="2" />
                  <path d="M3 10h18" />
                  <path d="M7 15h4" />
                </svg>
              </div>
              <h3>Faire Abrechnung</h3>
              <p>Pay-per-Epoch: du zahlst nur, solange du speicherst. Kein Mindestbetrag.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="msection" style={{ background: 'var(--card-soft)' }}>
        <div className="wrap">
          <div className="eyebrow">So funktioniert's</div>
          <h2 className="sectitle">In drei Schritten in deiner Cloud</h2>
          <p className="subtitle">Keine Installation, kein Konto mit Passwort — deine Wallet ist deine Identität.</p>
          <div className="howsteps">
            <div className="howstep">
              <div className="num">1</div>
              <h4>Wallet verbinden</h4>
              <p>MetaMask oder WalletConnect — dauert 10 Sekunden.</p>
            </div>
            <div className="howstep">
              <div className="num">2</div>
              <h4>Automatisch verschlüsseln</h4>
              <p>Jede Datei wird lokal in deinem Browser AES-256-verschlüsselt.</p>
            </div>
            <div className="howstep">
              <div className="num">3</div>
              <h4>Speichern &amp; teilen</h4>
              <p>Landet automatisch im richtigen Ordner, teilbar per Secure Send.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="msection" id="sicherheit">
        <div className="wrap">
          <div className="eyebrow">Vergleich</div>
          <h2 className="sectitle">Wie sich FocVault einordnet</h2>
          <p className="subtitle">Wir sind keine S3-Pipeline für Teams — sondern die persönliche Privacy-Cloud darüber.</p>
          <table className="comptable">
            <tbody>
              <tr>
                <th>&nbsp;</th>
                <th className="colhi">FocVault</th>
                <th>Klassische Cloud</th>
                <th>S3-Objektstorage</th>
              </tr>
              <tr>
                <td>Zero-Knowledge-Verschlüsselung</td>
                <td className="colhi">
                  <span className="okc">✓ ja</span>
                </td>
                <td>✗ nein</td>
                <td>✗ nein</td>
              </tr>
              <tr>
                <td>Mindestgebühr</td>
                <td className="colhi">
                  <span className="okc">Keine</span>
                </td>
                <td>meist ja</td>
                <td>z.B. $4.99/Monat</td>
              </tr>
              <tr>
                <td>Account/Login nötig</td>
                <td className="colhi">
                  <span className="okc">Nur Wallet</span>
                </td>
                <td>E-Mail + Passwort</td>
                <td>API-Keys</td>
              </tr>
              <tr>
                <td>Zielgruppe</td>
                <td className="colhi">Privatpersonen</td>
                <td>Privatpersonen</td>
                <td>Dev-Teams</td>
              </tr>
              <tr>
                <td>Datenhoheit bei Anbieterwechsel</td>
                <td className="colhi">
                  <span className="okc">Export + eigene Keys</span>
                </td>
                <td>oft Lock-in</td>
                <td>S3-kompatibel</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="msection" id="preise" style={{ background: 'var(--card-soft)' }}>
        <div className="wrap">
          <div className="eyebrow">Preise</div>
          <h2 className="sectitle">Fair, transparent, ohne Mindestbetrag</h2>
          <p className="subtitle">Bezahlt wird on-chain in USDFC — pro Epoche, genau für das was du speicherst.</p>
          <div className="pricing">
            <div className="plan">
              <h3>Free</h3>
              <div className="price">0 €<span>/Monat</span></div>
              <div className="desc">Für den Einstieg — Self-Pay, kostet uns nichts, kostet dich fast nichts.</div>
              <ul>
                <li><CheckIcon />20 MB Speicher</li>
                <li><CheckIcon />Zero-Knowledge-Verschlüsselung</li>
                <li><CheckIcon />Secure Send</li>
              </ul>
              <button onClick={handleConnect}>Kostenlos starten</button>
            </div>
            <div className="plan highlight">
              <span className="tag">Beliebt</span>
              <h3>Pro</h3>
              <div className="price">~5 USDFC<span>/Monat</span></div>
              <div className="desc">Für alle, die mehr als ein paar Dokumente sichern wollen.</div>
              <ul>
                <li><CheckIcon />2 GB Speicher</li>
                <li><CheckIcon />Chunking bis 2 GB pro Datei</li>
                <li><CheckIcon />Vault-Sync über alle Geräte</li>
                <li><CheckIcon />Priorisierter Support</li>
              </ul>
              <button className="primary" onClick={handleConnect}>Pro aktivieren</button>
            </div>
            <div className="plan">
              <h3>Business</h3>
              <div className="price">Individuell</div>
              <div className="desc">Teams, Compliance-Anforderungen, dedizierte Kapazität.</div>
              <ul>
                <li><CheckIcon />Individuelle Kapazität</li>
                <li><CheckIcon />Team-Vaults (geplant)</li>
                <li><CheckIcon />SLA &amp; dedizierter Support</li>
              </ul>
              <button onClick={handleConnect}>Kontakt</button>
            </div>
          </div>
        </div>
      </section>

      <section className="msection" id="faq">
        <div className="wrap">
          <div className="eyebrow">FAQ</div>
          <h2 className="sectitle">Häufige Fragen</h2>
          <div className="faq">
            <details open>
              <summary>Was bedeutet Zero-Knowledge genau?</summary>
              <p>
                Deine Dateien werden vor dem Hochladen in deinem Browser verschlüsselt. Wir
                speichern nur die verschlüsselten Bytes und eine Prüfsumme (CID) — den
                Schlüssel sehen wir nie.
              </p>
            </details>
            <details>
              <summary>Brauche ich eine Kryptowährung?</summary>
              <p>
                Ja, für die Storage-Zahlung wird USDFC benötigt (ein FIL-besicherter
                Stablecoin). Für kleine Dateien reicht ein Bruchteil eines Euros pro Monat.
              </p>
            </details>
            <details>
              <summary>Was passiert, wenn ich meine Wallet verliere?</summary>
              <p>
                Deine Wallet ist deine Identität — wie bei einem Passwort-Manager solltest du
                deine Wallet-Seed-Phrase sicher aufbewahren. Ein Recovery-Kit ist auf der
                Roadmap.
              </p>
            </details>
            <details>
              <summary>Wie unterscheidet sich das von S3-Anbietern wie fil.one?</summary>
              <p>
                S3-Anbieter richten sich an Entwickler-Teams (Buckets, API-Keys, kein
                Zero-Knowledge). FocVault ist die persönliche Privacy-Cloud für Menschen —
                Identity-Layer, Ende-zu-Ende-Verschlüsselung und eine Oberfläche ohne Code.
              </p>
            </details>
          </div>
        </div>
      </section>

      <section className="msection">
        <div className="wrap">
          <div className="ctaband">
            <h2>Bereit für deine eigene Privacy Cloud?</h2>
            <p>20 MB kostenlos. Keine Kreditkarte. In 2 Minuten startklar.</p>
            <div className="herobtns" style={{ justifyContent: 'center' }}>
              <button className="primary lg" onClick={handleConnect}>
                {isPending ? 'Verbinde…' : 'Kostenlos starten'}
              </button>
              <button className="lg">Mit uns sprechen</button>
            </div>
          </div>
        </div>
      </section>

      <footer className="sitefooter">
        <div className="wrap">
          <div className="footgrid">
            <div>
              <div className="footbrand">
                <svg className="mark" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r="20" fill="#0090ff" />
                </svg>
                FocVault
              </div>
              <div className="foottag">
                Deine Privacy Cloud auf Filecoin Onchain Cloud. Identity, Verschlüsselung,
                Storage — alles bei dir.
              </div>
            </div>
            <div className="footcol">
              <h5>Produkt</h5>
              <a href="#produkt">Meine Cloud</a>
              <a href="#produkt">Secure Send</a>
              <a href="#preise">Preise</a>
            </div>
            <div className="footcol">
              <h5>Unternehmen</h5>
              <a href="#sicherheit">Sicherheit</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="footcol">
              <h5>Rechtliches</h5>
              <a href="#">Datenschutz</a>
              <a href="#">AGB</a>
              <a href="#">Impressum</a>
            </div>
          </div>
          <div className="footbottom">
            <span>© 2026 FocVault. Gebaut auf Filecoin Onchain Cloud.</span>
            <span>Made possible by Synapse SDK &amp; FOC</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" fill="none" />
    </svg>
  )
}
