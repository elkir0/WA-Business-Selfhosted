--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'SQL_ASCII';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: notify_conversation_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_conversation_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM pg_notify('conversation_update', json_build_object(
        'id', NEW.id,
        'contact_id', NEW.contact_id,
        'status', NEW.status,
        'unread_count', NEW.unread_count,
        'last_message_preview', NEW.last_message_preview,
        'last_message_at', NEW.last_message_at
    )::text);
    RETURN NEW;
END;
$$;


--
-- Name: notify_new_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_new_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM pg_notify('new_message', json_build_object(
        'id', NEW.id,
        'conversation_id', NEW.conversation_id,
        'direction', NEW.direction,
        'message_type', NEW.message_type,
        'content', LEFT(NEW.content, 200),
        'created_at', NEW.created_at
    )::text);
    RETURN NEW;
END;
$$;


--
-- Name: upsert_contact(character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_contact(p_wa_id character varying, p_display_name character varying) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_contact_id INTEGER;
BEGIN
    INSERT INTO contacts (wa_id, display_name, last_message_at)
    VALUES (p_wa_id, p_display_name, NOW())
    ON CONFLICT (wa_id) DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, contacts.display_name),
        last_message_at = NOW(),
        updated_at = NOW()
    RETURNING id INTO v_contact_id;

    RETURN v_contact_id;
END;
$$;


--
-- Name: upsert_conversation(integer, text, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_conversation(p_contact_id integer, p_message_preview text DEFAULT NULL::text, p_direction character varying DEFAULT 'inbound'::character varying) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_conv_id INTEGER;
BEGIN
    INSERT INTO conversations (contact_id, last_message_preview, last_message_at)
    VALUES (p_contact_id, LEFT(p_message_preview, 200), NOW())
    ON CONFLICT (contact_id) DO UPDATE SET
        last_message_preview = COALESCE(LEFT(EXCLUDED.last_message_preview, 200), conversations.last_message_preview),
        last_message_at = NOW(),
        status = CASE
            WHEN conversations.status = 'closed' THEN 'active'
            ELSE conversations.status
        END,
        unread_count = CASE
            WHEN p_direction = 'inbound' THEN conversations.unread_count + 1
            ELSE conversations.unread_count
        END,
        -- Fenêtre 24h renouvelée sur message entrant
        window_expires = CASE
            WHEN p_direction = 'inbound' THEN NOW() + INTERVAL '24 hours'
            ELSE conversations.window_expires
        END,
        updated_at = NOW()
    RETURNING id INTO v_conv_id;

    RETURN v_conv_id;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id integer NOT NULL,
    wa_id character varying(20) NOT NULL,
    display_name character varying(255),
    profile_name character varying(255),
    tags text[] DEFAULT '{}'::text[],
    metadata jsonb DEFAULT '{}'::jsonb,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contacts_id_seq OWNED BY public.contacts.id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id integer NOT NULL,
    contact_id integer,
    status character varying(20) DEFAULT 'active'::character varying,
    assigned_to character varying(100),
    ai_enabled boolean DEFAULT true,
    unread_count integer DEFAULT 0,
    last_message_preview text,
    last_message_at timestamp with time zone,
    window_expires timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    human_takeover_until timestamp with time zone
);


--
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- Name: fallback_sms_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fallback_sms_log (
    id integer NOT NULL,
    phone character varying(20) NOT NULL,
    content text NOT NULL,
    source_type character varying(50) NOT NULL,
    source_msg_ids integer[] NOT NULL,
    trigger_reason character varying(50) NOT NULL,
    sms_message_id integer,
    status character varying(20) NOT NULL,
    sent_at timestamp with time zone DEFAULT now(),
    error_details jsonb,
    content_hash character(64)
);


--
-- Name: fallback_sms_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fallback_sms_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fallback_sms_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fallback_sms_log_id_seq OWNED BY public.fallback_sms_log.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    conversation_id integer,
    wamid character varying(255),
    direction character varying(20) NOT NULL,
    message_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    content text,
    media_path character varying(500),
    media_mime_type character varying(100),
    media_data jsonb,
    template_data jsonb,
    interactive_data jsonb,
    raw_payload jsonb,
    status character varying(20) DEFAULT 'received'::character varying,
    status_updated timestamp with time zone,
    error_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    error_code integer,
    error_details jsonb,
    external_msg_id character varying(255),
    source character varying(50),
    content_hash character(64),
    recipient_phone character varying(20),
    delivery_deadline_at timestamp with time zone,
    fallback_eligible boolean DEFAULT true NOT NULL,
    fallback_sms_log_id integer
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id integer NOT NULL,
    user_id character varying(100),
    endpoint text NOT NULL,
    p256dh_key text NOT NULL,
    auth_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;


--
-- Name: v_inbox; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_inbox AS
 SELECT c.id AS conversation_id,
    ct.wa_id,
    ct.display_name,
    c.status,
    c.assigned_to,
    c.ai_enabled,
    c.unread_count,
    c.last_message_preview,
    c.last_message_at,
    c.window_expires,
    (c.window_expires > now()) AS window_open,
    c.human_takeover_until,
    (c.human_takeover_until > now()) AS human_takeover_active,
    ct.tags,
    ct.metadata
   FROM (public.conversations c
     JOIN public.contacts ct ON ((ct.id = c.contact_id)))
  ORDER BY c.last_message_at DESC;


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id integer NOT NULL,
    event_type character varying(50),
    payload jsonb NOT NULL,
    processed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_events_id_seq OWNED BY public.webhook_events.id;


--
-- Name: webhook_events_unmatched; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events_unmatched (
    id integer NOT NULL,
    meta_wamid character varying(255),
    recipient character varying(20),
    status character varying(20),
    meta_ts timestamp with time zone,
    payload jsonb,
    marker character varying(50),
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: webhook_events_unmatched_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_events_unmatched_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_events_unmatched_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_events_unmatched_id_seq OWNED BY public.webhook_events_unmatched.id;


--
-- Name: contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts ALTER COLUMN id SET DEFAULT nextval('public.contacts_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- Name: fallback_sms_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fallback_sms_log ALTER COLUMN id SET DEFAULT nextval('public.fallback_sms_log_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);


--
-- Name: webhook_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events ALTER COLUMN id SET DEFAULT nextval('public.webhook_events_id_seq'::regclass);


--
-- Name: webhook_events_unmatched id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events_unmatched ALTER COLUMN id SET DEFAULT nextval('public.webhook_events_unmatched_id_seq'::regclass);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_wa_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_wa_id_key UNIQUE (wa_id);


--
-- Name: conversations conversations_contact_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_contact_id_key UNIQUE (contact_id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: fallback_sms_log fallback_sms_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fallback_sms_log
    ADD CONSTRAINT fallback_sms_log_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: messages messages_wamid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_wamid_key UNIQUE (wamid);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_events_unmatched webhook_events_unmatched_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events_unmatched
    ADD CONSTRAINT webhook_events_unmatched_pkey PRIMARY KEY (id);


--
-- Name: idx_contacts_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_last_message ON public.contacts USING btree (last_message_at DESC);


--
-- Name: idx_contacts_wa_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_wa_id ON public.contacts USING btree (wa_id);


--
-- Name: idx_conversations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_status ON public.conversations USING btree (status, last_message_at DESC);


--
-- Name: idx_fallback_phone_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fallback_phone_hash ON public.fallback_sms_log USING btree (phone, content_hash, sent_at DESC);


--
-- Name: idx_fallback_phone_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fallback_phone_sent ON public.fallback_sms_log USING btree (phone, sent_at DESC);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id, created_at DESC);


--
-- Name: idx_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created ON public.messages USING btree (created_at DESC);


--
-- Name: idx_messages_error; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_error ON public.messages USING btree (error_code) WHERE (error_code IS NOT NULL);


--
-- Name: idx_messages_outbound_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_outbound_pending ON public.messages USING btree (delivery_deadline_at) WHERE (((direction)::text = 'outbound'::text) AND (fallback_eligible = true) AND ((status)::text <> ALL (ARRAY[('delivered'::character varying)::text, ('read'::character varying)::text, ('fallback_sent'::character varying)::text, ('fallback_skipped'::character varying)::text, ('failed'::character varying)::text])));


--
-- Name: idx_messages_phone_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_phone_sent ON public.messages USING btree (recipient_phone, created_at);


--
-- Name: idx_messages_wamid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_wamid ON public.messages USING btree (wamid);


--
-- Name: idx_messages_external_msg_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_messages_external_msg_id_uniq ON public.messages USING btree (external_msg_id) WHERE (external_msg_id IS NOT NULL);


--
-- Name: idx_unmatched_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unmatched_created ON public.webhook_events_unmatched USING btree (created_at);


--
-- Name: idx_webhook_events_unprocessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_unprocessed ON public.webhook_events USING btree (processed, created_at) WHERE (processed = false);


--
-- Name: conversations conversation_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversation_notify AFTER UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.notify_conversation_update();


--
-- Name: messages message_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER message_notify AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();


--
-- Name: conversations conversations_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: messages fk_messages_fallback; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_fallback FOREIGN KEY (fallback_sms_log_id) REFERENCES public.fallback_sms_log(id) ON DELETE SET NULL;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


