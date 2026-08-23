import nodemailer from "nodemailer";
import QRCode from "qrcode";
import { logger } from "./logger";

type Ticket = {
  email: string;
  name: string;
  reference: string;
  title: string;
  venue: string;
  startsAt: string;
  seats: string[];
  qrData: string;
};

const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    })
  : null;

export async function makeQrData(reference: string) {
  return QRCode.toDataURL(`scenepass:${reference}`);
}

export async function sendTicketEmail(ticket: Ticket) {
  if (!transporter || !process.env.SMTP_FROM) {
    logger.info({ reference: ticket.reference }, "SMTP not configured; ticket available in the app");
    return;
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: ticket.email,
    subject: `Your ScenePass ticket · ${ticket.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px"><h1>${ticket.title}</h1><p>Hi ${ticket.name}, your booking is confirmed.</p><p><b>${ticket.venue}</b><br>${ticket.startsAt}<br>Seats: ${ticket.seats.join(", ")}</p><p>Booking reference: <b>${ticket.reference}</b></p><img width="220" src="${ticket.qrData}" alt="Ticket QR code"></div>`,
  });
}

export async function sendWaitlistOfferEmail(email: string, title: string, offerId: string, expiresAt: Date) {
  if (!transporter || !process.env.SMTP_FROM) {
    logger.info({ offerId }, "SMTP not configured; waitlist offer available in the app");
    return;
  }
  const base = process.env.APP_URL || "";
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `A seat opened up for ${title}`,
    html: `<p>A seat is available for <b>${title}</b> for the next ${minutes} minute${minutes === 1 ? "" : "s"}.</p><p><a href="${base}/waitlist?offer=${offerId}">Claim your seat</a></p><p>This offer expires at ${expiresAt.toISOString()}.</p>`,
  });
}
