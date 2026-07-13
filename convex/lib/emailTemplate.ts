// Shared branded HTML shell for every outgoing WAI-ME email. The plain-text
// part of each email remains the canonical, vault-verbatim copy (and what the
// tests assert on); this shell only re-renders that same copy for HTML-capable
// clients. Email-client constraints shape everything here: tables + inline
// styles only, no hosted images (staging sits behind basic auth, so a linked
// logo would 401 into a broken icon), brand carried typographically. Palette
// mirrors src/styles/tokens.css: ink #060d1c, navy #0a1d3f, sky #2aa4ef /
// #018be1, mist #cfe0f5, paper #f6f1e8, paper-ink #15233f, dawn #ffc174 /
// #ff8e8a (the sunrise horizon line, the brand's aviation-dawn signature).

import { SITE } from "../../site.config.mjs";

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";

export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const P_STYLE = `margin:0 0 16px;font:400 15px/1.65 ${SANS};color:#15233f;`;

export const emailP = (innerHtml: string): string =>
  `<p style="${P_STYLE}">${innerHtml}</p>`;

export const emailLink = (url: string, label?: string): string =>
  `<a href="${escapeHtml(url)}" style="color:#0a6fc2;text-decoration:underline;">${escapeHtml(label ?? url)}</a>`;

export const emailList = (itemsHtml: string[]): string =>
  `<ul style="margin:0 0 16px;padding:0 0 0 22px;">${itemsHtml
    .map(
      (item) =>
        `<li style="margin:0 0 10px;font:400 15px/1.6 ${SANS};color:#15233f;">${item}</li>`,
    )
    .join("")}</ul>`;

export type BrandedEmail = {
  // First line inbox previews show after the subject; hidden in the body.
  preheader: string;
  heading: string;
  // Pre-rendered with emailP / emailList / emailLink; already escaped.
  bodyHtml: string;
  cta?: { label: string; url: string };
  footnote?: string;
};

export const renderBrandedEmail = ({
  preheader,
  heading,
  bodyHtml,
  cta,
  footnote,
}: BrandedEmail): string => {
  const ctaHtml =
    cta === undefined
      ? ""
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto 26px;">
          <tr>
            <td bgcolor="#018be1" style="border-radius:10px;">
              <a href="${escapeHtml(cta.url)}"
                 style="display:block;padding:14px 30px;font:700 15px/1.45 ${SANS};color:#ffffff;text-decoration:none;text-align:center;border-radius:10px;">
                ${escapeHtml(cta.label)}</a>
            </td>
          </tr>
        </table>`;

  const footnoteHtml =
    footnote === undefined
      ? ""
      : `<div style="margin-top:24px;padding-top:18px;border-top:1px solid #efe6d6;font:400 13px/1.6 ${SANS};color:#5b6376;">${footnote}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f6f1e8;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f1e8">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td bgcolor="#060d1c" style="padding:30px 40px;border-radius:14px 14px 0 0;">
              <div style="font:700 11px/1.4 ${SANS};letter-spacing:4px;color:#6cc8ff;text-transform:uppercase;">Women in Aviation</div>
              <div style="font:700 26px/1.25 ${SERIF};color:#ffffff;margin-top:6px;">Middle East</div>
            </td>
          </tr>
          <tr>
            <td style="line-height:0;font-size:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="55%" height="3" bgcolor="#2aa4ef" style="line-height:3px;font-size:0;">&nbsp;</td>
                  <td width="30%" height="3" bgcolor="#ffc174" style="line-height:3px;font-size:0;">&nbsp;</td>
                  <td width="15%" height="3" bgcolor="#ff8e8a" style="line-height:3px;font-size:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px;border-radius:0 0 14px 14px;">
              <h1 style="margin:0 0 18px;font:700 21px/1.35 ${SERIF};color:#0a1d3f;">${escapeHtml(heading)}</h1>
              ${bodyHtml}
              ${ctaHtml}
              ${footnoteHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 40px;font:400 12px/1.7 ${SANS};color:#5b6376;">
              Women in Aviation Middle East<br>
              <a href="mailto:support@waiorg.me" style="color:#5b6376;text-decoration:underline;">support@waiorg.me</a>
              &nbsp;&middot;&nbsp;
              <a href="${escapeHtml(SITE)}" style="color:#5b6376;text-decoration:underline;">waiorg.me</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
