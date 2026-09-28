/** FocVault-Schriftzug: „Foc“ dunkel, „Vault“ blau – das V sitzt halb auf dem C. */
export default function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} aria-label="FocVault">
      <span className="wm-foc" aria-hidden="true">
        Foc
      </span>
      <span className="wm-vault" aria-hidden="true">
        <span className="wm-v">V</span>ault
      </span>
    </span>
  )
}
