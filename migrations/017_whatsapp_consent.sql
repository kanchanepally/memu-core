CREATE TABLE IF NOT EXISTS whatsapp_connected_chats (
    family_id TEXT NOT NULL REFERENCES family_settings(family_id) ON DELETE CASCADE,
    chat_jid TEXT NOT NULL, -- The WhatsApp JID of the chat to listen to (e.g., 1234567890@s.whatsapp.net)
    participant_names TEXT, -- Comma separated names for UI display
    consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (family_id, chat_jid)
);
