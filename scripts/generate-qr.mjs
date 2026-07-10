/**
 * Generiert die beiden Spenden-QR-Codes als SVG in einheitlicher Optik.
 * Läuft als Teil von `pnpm run build` (siehe package.json).
 *
 * - qr-iban.svg: EPC-QR-Code („Girocode“) — Banking-Apps füllen die
 *   Überweisung damit automatisch aus. Payload identisch mit dem
 *   früheren Bestandscode (inkl. 50-€-Vorschlag, in der App änderbar).
 * - qr-paypal.svg: Link auf paypal.me/foerderbaumhaus.
 */
import QRCode from "qrcode"
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "../src/assets")

// EPC069-12 (Version 001, mit BIC). Zeilen exakt in dieser Reihenfolge.
const epcPayload = [
  "BCD",
  "001",
  "1",
  "SCT",
  "GENODE61HD3",
  "Foerderverein des Evangelischen Kindergartens Das Baumhaus Großsachsen e.V.",
  "DE29672901000061226508",
  "EUR50",
  "",
  "",
  "Spende an den Foerderverein",
].join("\n")

const paypalUrl = "https://paypal.me/foerderbaumhaus"

// Dunkles Markengrün auf Weiß — deutlich über dem nötigen Scan-Kontrast
const style = {
  type: "svg",
  errorCorrectionLevel: "M", // von der EPC-Spezifikation gefordert
  margin: 2,
  width: 600, // explizite width/height-Attribute, sonst rendert das SVG in viewBox-Größe
  color: { dark: "#1e3a29", light: "#ffffff" },
}

for (const [file, content] of [
  ["qr-iban.svg", epcPayload],
  ["qr-paypal.svg", paypalUrl],
]) {
  const svg = await QRCode.toString(content, style)
  await writeFile(join(assetsDir, file), svg)
  console.log(`✓ ${file} generiert`)
}
