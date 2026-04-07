use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};

use crate::{
    config::Config,
    error::{ApiError, AppResult},
};

pub struct MailSender {
    from: Mailbox,
    transport: AsyncSmtpTransport<Tokio1Executor>,
}

impl MailSender {
    pub fn from_config(config: &Config) -> Option<Self> {
        let host = config.smtp_host.as_deref()?.trim();
        if host.is_empty() {
            return None;
        }

        let from_address = config.smtp_from_address.as_deref()?.trim();
        if from_address.is_empty() {
            return None;
        }

        let from = if let Some(from_name) = config
            .smtp_from_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Mailbox::new(Some(from_name.to_owned()), from_address.parse().ok()?)
        } else {
            Mailbox::new(None, from_address.parse().ok()?)
        };

        let transport = if config.smtp_starttls {
            let mut builder = AsyncSmtpTransport::<Tokio1Executor>::relay(host)
                .ok()?
                .port(config.smtp_port);

            if let Some(username) = config
                .smtp_username
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                builder = builder.credentials(Credentials::new(
                    username.to_owned(),
                    config.smtp_password.clone().unwrap_or_default(),
                ));
            }

            builder.build()
        } else {
            let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
                .port(config.smtp_port);

            if let Some(username) = config
                .smtp_username
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                builder = builder.credentials(Credentials::new(
                    username.to_owned(),
                    config.smtp_password.clone().unwrap_or_default(),
                ));
            }

            builder.build()
        };

        Some(Self { from, transport })
    }

    pub async fn send_text_email(
        &self,
        to_email: &str,
        subject: &str,
        body: &str,
    ) -> AppResult<()> {
        let to_mailbox: Mailbox = to_email.parse().map_err(|error| {
            ApiError::validation(format!("invalid recipient email address: {error}"))
        })?;
        let message = Message::builder()
            .from(self.from.clone())
            .to(to_mailbox)
            .subject(subject)
            .body(body.to_owned())
            .map_err(|error| ApiError::internal(format!("failed to build otp email: {error}")))?;

        self.transport
            .send(message)
            .await
            .map_err(|error| ApiError::internal(format!("failed to send otp email: {error}")))?;

        Ok(())
    }
}
