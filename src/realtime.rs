use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::metrics::AppMetrics;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeEvent {
    pub event: String,
    pub account_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Clone)]
pub struct RealtimeBroker {
    sender: broadcast::Sender<RealtimeEvent>,
}

impl RealtimeBroker {
    pub fn new(buffer_size: usize) -> Self {
        let (sender, _) = broadcast::channel(buffer_size.max(32));
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RealtimeEvent> {
        self.sender.subscribe()
    }

    pub fn publish(
        &self,
        metrics: &AppMetrics,
        event: &str,
        account_id: Uuid,
        message_id: Option<Uuid>,
    ) {
        let payload = RealtimeEvent {
            event: event.to_owned(),
            account_id: account_id.to_string(),
            message_id: message_id.map(|value| value.to_string()),
            timestamp: Utc::now(),
        };

        let _ = self.sender.send(payload);
        metrics.record_realtime_event();
    }
}
