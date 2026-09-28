import { z } from 'zod'

/** base64url mit exakter Byte-Länge. */
export const b64u = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'base64url erwartet')
    .refine(s => Buffer.from(s, 'base64url').length === bytes, `genau ${bytes} Byte erwartet`)

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Ungültige E-Mail-Adresse').max(254))

/** Argon2id-Parameter; Untergrenze = OWASP-Empfehlung (19 MiB, t=2). */
export const kdfSchema = z.object({
  alg: z.literal('argon2id'),
  v: z.literal(1),
  salt: b64u(16),
  m: z.number().int().min(19_456).max(1_048_576),
  t: z.number().int().min(2).max(10),
  p: z.number().int().min(1).max(4)
})

export const envelopeSchema = z.object({
  kekType: z.enum(['passphrase', 'recovery']),
  iv: b64u(12),
  cipher: b64u(48)
})

export const registerSchema = z
  .object({
    email: emailSchema,
    authKey: b64u(32),
    recoveryAuthKey: b64u(32),
    recoveryLookup: b64u(32).optional(),
    kdf: kdfSchema,
    envelopes: z.array(envelopeSchema).length(2)
  })
  .refine(v => new Set(v.envelopes.map(e => e.kekType)).size === 2, {
    message: 'Passphrase- und Recovery-Envelope erforderlich',
    path: ['envelopes']
  })

export const preloginSchema = z.object({ email: emailSchema })
export const loginSchema = z.object({ email: emailSchema, authKey: b64u(32) })
/** Bestätigung mit Passphrase in einer bestehenden Session (z. B. nach SSO) */
export const reauthSchema = z.object({ authKey: b64u(32) })
/** Wiederherstellen: E-Mail (ältere Konten) oder nur die aus den 24 Wörtern abgeleitete Kennung. */
export const recoverySchema = z
  .object({ email: emailSchema.optional(), recoveryLookup: b64u(32).optional(), recoveryAuthKey: b64u(32) })
  .refine(v => !!v.email || !!v.recoveryLookup, { message: 'E-Mail oder Recovery-Kennung erforderlich' })

export const passphraseSchema = z.object({
  authKey: b64u(32),
  kdf: kdfSchema,
  envelope: envelopeSchema.refine(e => e.kekType === 'passphrase', { message: 'Passphrase-Envelope erwartet' })
})

export const walletLoginSchema = z.object({
  message: z.string().min(20).max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, 'Hex-Signatur erwartet').max(20_000)
})

export const walletRegisterSchema = z
  .object({
    registrationToken: z.string().min(10).max(300),
    label: z.string().trim().max(120).optional(),
    authKey: b64u(32),
    recoveryAuthKey: b64u(32),
    recoveryLookup: b64u(32).optional(),
    kdf: kdfSchema,
    envelopes: z.array(envelopeSchema).length(2)
  })
  .refine(v => new Set(v.envelopes.map(e => e.kekType)).size === 2, {
    message: 'Passphrase- und Recovery-Envelope erforderlich',
    path: ['envelopes']
  })

export const recoverySessionSchema = z.object({ recoveryAuthKey: b64u(32), recoveryLookup: b64u(32).optional() })

export const planSchema = z.object({ plan: z.enum(['free', 'pro', 'family', 'business']) })
