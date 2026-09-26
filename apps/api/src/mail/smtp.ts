import nodemailer, { type Transporter } from 'nodemailer';

export type TransportSecurity = 'STARTTLS' | 'IMPLICIT_TLS';

export interface SmtpConfiguration {
  host: string;
  port: number;
  transportSecurity: TransportSecurity;
  username: string | null;
  password: string | null;
  fromEmail: string;
  fromName: string;
}

export function createSmtpTransport(configuration: SmtpConfiguration): Transporter {
  return nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.transportSecurity === 'IMPLICIT_TLS',
    requireTLS: configuration.transportSecurity === 'STARTTLS',
    auth:
      configuration.username === null || configuration.password === null
        ? undefined
        : { user: configuration.username, pass: configuration.password },
  });
}

export function senderAddress(configuration: SmtpConfiguration): string {
  return `${configuration.fromName} <${configuration.fromEmail}>`;
}
