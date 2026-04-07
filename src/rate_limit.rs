use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug)]
pub struct RateLimitPolicy {
    pub limit: usize,
    pub window: Duration,
}

#[derive(Debug)]
struct FixedWindowBucket {
    window_started_at: Instant,
    attempts: usize,
}

#[derive(Debug, Default)]
pub struct FixedWindowRateLimiter {
    buckets: HashMap<String, FixedWindowBucket>,
    operations: usize,
}

impl FixedWindowRateLimiter {
    pub fn check_and_record(&mut self, key: &str, policy: RateLimitPolicy) -> bool {
        let now = Instant::now();
        let window = policy.window;
        let limit = policy.limit.max(1);

        self.maybe_cleanup(now, window);

        let bucket = self
            .buckets
            .entry(key.to_owned())
            .or_insert(FixedWindowBucket {
                window_started_at: now,
                attempts: 0,
            });

        if now.duration_since(bucket.window_started_at) >= window {
            bucket.window_started_at = now;
            bucket.attempts = 0;
        }

        if bucket.attempts >= limit {
            return false;
        }

        bucket.attempts += 1;
        true
    }

    pub fn clear(&mut self, key: &str) {
        self.buckets.remove(key);
    }

    fn maybe_cleanup(&mut self, now: Instant, window: Duration) {
        self.operations = self.operations.wrapping_add(1);
        if self.operations % 256 != 0 {
            return;
        }

        let retention = window.checked_mul(2).unwrap_or(window);
        self.buckets
            .retain(|_, bucket| now.duration_since(bucket.window_started_at) < retention);
    }
}

#[cfg(test)]
mod tests {
    use super::{FixedWindowRateLimiter, RateLimitPolicy};
    use std::time::Duration;

    #[test]
    fn rejects_attempts_after_limit_in_same_window() {
        let mut limiter = FixedWindowRateLimiter::default();
        let policy = RateLimitPolicy {
            limit: 2,
            window: Duration::from_secs(60),
        };

        assert!(limiter.check_and_record("login:alice", policy));
        assert!(limiter.check_and_record("login:alice", policy));
        assert!(!limiter.check_and_record("login:alice", policy));
    }

    #[test]
    fn clear_resets_bucket() {
        let mut limiter = FixedWindowRateLimiter::default();
        let policy = RateLimitPolicy {
            limit: 1,
            window: Duration::from_secs(60),
        };

        assert!(limiter.check_and_record("login:alice", policy));
        assert!(!limiter.check_and_record("login:alice", policy));

        limiter.clear("login:alice");

        assert!(limiter.check_and_record("login:alice", policy));
    }
}
