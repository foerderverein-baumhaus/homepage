/**
 * Vercel-Function: nimmt den Mitgliedsantrag entgegen und schickt ihn
 * per Mail an den Vorstandsverteiler.
 *
 * Benötigte Environment-Variablen (Vercel → Project Settings → Environment Variables):
 *   SMTP_USER  – ein echtes Google-Workspace-Konto (z.B. s.werner@foerderverein-baumhaus.de)
 *   SMTP_PASS  – App-Passwort dieses Kontos (Google-Konto → Sicherheit → App-Passwörter)
 *   MAIL_TO    – optional, Standard: info@foerderverein-baumhaus.de (Google-Group-Verteiler)
 */
import nodemailer from "nodemailer"

interface ApiRequest {
  method?: string
  body?: unknown
}

interface ApiResponse {
  status(code: number): ApiResponse
  json(body: unknown): void
  setHeader(name: string, value: string): void
}

interface Antrag {
  vorname: string
  name: string
  strasse: string
  plzOrt: string
  email: string
  telefon: string
  iban: string
  kontoinhaber: string
}

const MAX_FIELD_LENGTH = 200

function cleanField(value: unknown): string {
  if (typeof value !== "string") return ""
  // Zeilenumbrüche raus (Header-Injection), Länge begrenzen
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_FIELD_LENGTH)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

/** IBAN auf reine Zeichen reduzieren (toleriert Punkte, Bindestriche etc.). */
function normalizeIban(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
}

/** In Vierergruppen formatieren für die Mail. */
function formatIban(raw: string): string {
  return normalizeIban(raw).match(/.{1,4}/g)?.join(" ") ?? raw
}

/** Generische IBAN-Prüfung: Format + Mod-97-Prüfziffer (ISO 13616). */
function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55)
  )
  // Mod 97 über String, um BigInt-freie Arithmetik zu behalten
  let remainder = 0
  for (const char of digits) {
    remainder = (remainder * 10 + Number(char)) % 97
  }
  return remainder === 1
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    res.status(405).json({ error: "Nur POST erlaubt." })
    return
  }

  const body = (typeof req.body === "object" && req.body !== null
    ? req.body
    : {}) as Record<string, unknown>

  // Honeypot: Bots füllen das unsichtbare Feld – so tun, als wäre alles gut
  if (cleanField(body.website) !== "") {
    res.status(200).json({ ok: true })
    return
  }

  const antrag: Antrag = {
    vorname: cleanField(body.vorname),
    name: cleanField(body.name),
    strasse: cleanField(body.strasse),
    plzOrt: cleanField(body.plzOrt),
    email: cleanField(body.email),
    telefon: cleanField(body.telefon),
    iban: cleanField(body.iban),
    kontoinhaber: cleanField(body.kontoinhaber),
  }

  const fehler: Record<string, string> = {}
  if (!antrag.vorname) fehler.vorname = "Bitte den Vornamen angeben."
  if (!antrag.name) fehler.name = "Bitte den Nachnamen angeben."
  if (!antrag.strasse) fehler.strasse = "Bitte Straße und Hausnummer angeben."
  if (!antrag.plzOrt) fehler.plzOrt = "Bitte PLZ und Ort angeben."
  if (!antrag.email || !isValidEmail(antrag.email))
    fehler.email = "Bitte eine gültige E-Mail-Adresse angeben."
  if (!antrag.iban || !isValidIban(antrag.iban))
    fehler.iban =
      "Diese IBAN scheint nicht zu stimmen — bitte einmal prüfen (Tippfehler passieren schnell)."
  const einwilligung =
    body.einwilligung === true ||
    body.einwilligung === "true" ||
    body.einwilligung === "on"
  if (!einwilligung)
    fehler.einwilligung =
      "Ohne Anerkennung der Satzung und SEPA-Einwilligung können wir den Antrag nicht annehmen."

  if (Object.keys(fehler).length > 0) {
    res.status(400).json({ error: "Bitte Eingaben prüfen.", fehler })
    return
  }

  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS
  const useJsonTransport = process.env.MAIL_TRANSPORT === "json"

  if (!useJsonTransport && (!smtpUser || !smtpPass)) {
    res.status(500).json({
      error:
        "Der Mailversand ist auf dem Server noch nicht eingerichtet. Bitte nutzen Sie den E-Mail-Weg unten.",
    })
    return
  }

  const transporter = useJsonTransport
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: smtpUser, pass: smtpPass },
      })

  const empfaenger = process.env.MAIL_TO || "info@foerderverein-baumhaus.de"
  const eingegangen = new Date().toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "full",
    timeStyle: "short",
  })

  const text = [
    "Neuer Mitgliedsantrag über die Website:",
    "",
    `Name:           ${antrag.vorname} ${antrag.name}`,
    `Anschrift:      ${antrag.strasse}, ${antrag.plzOrt}`,
    `E-Mail:         ${antrag.email}`,
    `Telefon:        ${antrag.telefon || "–"}`,
    "",
    `IBAN:           ${formatIban(antrag.iban)}`,
    `Kontoinhaber:   ${antrag.kontoinhaber || "(wie Antragsteller/in)"}`,
    "",
    "Die antragstellende Person hat die Satzung anerkannt und den",
    "Förderverein ermächtigt, den Jahresbeitrag von 15 € bei Fälligkeit",
    "per SEPA-Lastschrift vom angegebenen Konto einzuziehen.",
    "",
    `Eingegangen am: ${eingegangen}`,
    "",
    "Antworten an diese Mail gehen direkt an die antragstellende Person.",
  ].join("\n")

  try {
    const info = await transporter.sendMail({
      from: `"Website Förderverein" <${smtpUser ?? "test@example.org"}>`,
      to: empfaenger,
      // Gmail stellt eigene Gruppen-Posts dem Absender nicht zu — daher
      // eine direkte Kopie an das Versandkonto selbst
      cc: smtpUser,
      replyTo: `"${antrag.vorname} ${antrag.name}" <${antrag.email}>`,
      subject: `Neuer Mitgliedsantrag: ${antrag.vorname} ${antrag.name}`,
      text,
    })
    // Bestätigung an die antragstellende Person — Scheitern hiervon
    // darf den bereits zugestellten Antrag nicht als Fehler melden
    let confirmation: unknown = null
    try {
      const confirmationInfo = await transporter.sendMail({
        from: `"Förderverein Das Baumhaus" <${smtpUser ?? "test@example.org"}>`,
        to: `"${antrag.vorname} ${antrag.name}" <${antrag.email}>`,
        replyTo: empfaenger,
        subject: "Ihr Mitgliedsantrag beim Förderverein „Das Baumhaus“",
        text: [
          `Hallo ${antrag.vorname} ${antrag.name},`,
          "",
          "vielen Dank für Ihren Aufnahmeantrag — er ist beim Vorstand",
          "eingegangen. Wir melden uns in den nächsten Tagen persönlich",
          "bei Ihnen. Schön, dass Sie dabei sind!",
          "",
          "Zur Erinnerung: Der Jahresbeitrag beträgt 15 € und wird einmal",
          "im Jahr per SEPA-Lastschrift eingezogen.",
          "",
          "Sie haben Fragen? Antworten Sie einfach auf diese E-Mail.",
          "",
          "Herzliche Grüße",
          "Der Vorstand des Fördervereins",
          'des Evangelischen Kindergartens „Das Baumhaus“ Großsachsen e.V.',
          "https://www.foerderverein-baumhaus.de",
        ].join("\n"),
      })
      if (useJsonTransport) {
        confirmation = JSON.parse(
          (confirmationInfo as unknown as { message: string }).message
        )
      }
    } catch (error) {
      console.error("Mitgliedsantrag: Bestätigungsmail fehlgeschlagen", error)
    }

    if (useJsonTransport) {
      // Testmodus: gerenderte Mails zurückgeben statt zu senden
      const rendered = (info as unknown as { message: string }).message
      res
        .status(200)
        .json({ ok: true, test: JSON.parse(rendered), confirmation })
      return
    }
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error("Mitgliedsantrag: Mailversand fehlgeschlagen", error)
    res.status(500).json({
      error:
        "Der Antrag konnte gerade nicht übermittelt werden. Bitte versuchen Sie es später erneut oder nutzen Sie den E-Mail-Weg unten.",
    })
  }
}
