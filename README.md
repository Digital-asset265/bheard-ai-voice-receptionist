# BHeard — AI Voice Receptionist

BHeard is a real-time AI voice receptionist designed for service businesses.

It answers incoming phone calls, identifies the business associated with the called number, loads company-specific knowledge, holds a natural voice conversation with the caller, qualifies potential customers, and creates structured leads inside a built-in CRM.

The project was built as a full-stack application combining telephony, real-time AI, WebSockets, business-specific knowledge and lead management.

## What BHeard Does

When a customer calls a BHeard-enabled phone number:

1. Twilio receives the incoming call.
2. BHeard identifies which business owns that phone number.
3. The business ID is passed to the voice engine.
4. Company-specific information is loaded from Supabase.
5. The call audio is streamed through WebSockets.
6. OpenAI Realtime handles the live AI conversation.
7. The AI can answer questions using knowledge belonging specifically to that business.
8. When appropriate, the AI qualifies the caller and collects lead information.
9. The lead is stored in Supabase and becomes available in the BHeard dashboard.
10. The system can notify business users about new leads.

## Architecture

```text
                         ┌─────────────────┐
                         │     Caller      │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │     Twilio      │
                         │ Incoming Number │
                         └────────┬────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │   Next.js Voice Webhook  │
                    │   /api/twilio/voice      │
                    └────────────┬─────────────┘
                                 │
                    Resolve phone → business
                                 │
                                 ▼
                         ┌─────────────────┐
                         │    Supabase     │
                         │ Business / Data │
                         └────────┬────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │   WebSocket Voice Engine │
                    │     /twilio-stream       │
                    └────────────┬─────────────┘
                                 │
                    Bidirectional audio stream
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │    OpenAI Realtime API   │
                    │   Live AI Conversation   │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
              ▼                                     ▼
    ┌───────────────────┐                 ┌───────────────────┐
    │ Company Knowledge │                 │ Lead Qualification│
    │ Business-specific │                 │ & Function Calls  │
    └───────────────────┘                 └─────────┬─────────┘
                                                   │
                                                   ▼
                                         ┌───────────────────┐
                                         │      Supabase     │
                                         │    Leads / CRM    │
                                         └─────────┬─────────┘
                                                   │
                                                   ▼
                                         ┌───────────────────┐
                                         │   Notifications   │
                                         └───────────────────┘
```

## Core Features

### Real-Time AI Voice

BHeard connects incoming phone calls to a real-time AI conversation through Twilio Media Streams and WebSockets.

The system supports bidirectional audio so callers can interact with the AI using a normal telephone call.

### Company-Specific Knowledge

Each business can have its own knowledge stored in the system.

When a call starts, BHeard determines which company is being called and injects only that company's information into the AI session.

This allows the receptionist to answer business-specific questions while reducing the risk of mixing information between different companies.

### Lead Qualification

The AI can naturally collect structured information from callers.

Depending on the configured business/industry behavior, this can include information such as:

- Customer name
- Phone number
- Email
- Address
- Problem description
- Problem type
- Urgency
- Severity

Once enough information has been collected, the AI can create the lead automatically.

### Built-In Lead Management

BHeard includes its own lead management interface.

Businesses can access leads generated by the AI and manage them through the application.

The project includes functionality for:

- New leads
- Lead details
- Archived leads
- Lead status management
- Business-specific lead separation

### Multi-Business Architecture

Phone numbers are mapped to individual businesses.

An incoming call is therefore routed using the called number:

```text
Phone Number
     ↓
Business ID
     ↓
Business Configuration
     ↓
Company Knowledge
     ↓
AI Session
```

This architecture allows the same platform to support multiple independent businesses.

### Multi-Industry Foundation

The voice engine contains industry-specific behavior logic rather than relying on a single universal conversation flow.

The project currently contains foundations for different service-business configurations, including roofing and dental use cases.

### Notifications

The system contains infrastructure for notifying users when new leads are created, including Supabase functions and push-notification integration.

### User & Business Management

The application also includes infrastructure for:

- Authentication
- User registration
- Business accounts
- User invitations
- Business membership
- Administrative management
- Phone-number assignment

### Mobile Application Foundation

BHeard also contains an Android/Capacitor application structure, allowing the web application to be packaged as a mobile experience.

## Tech Stack

### Frontend

- Next.js
- React
- TypeScript
- CSS

### Backend

- Node.js
- Next.js API Routes
- WebSockets
- Supabase
- Supabase Edge Functions

### AI

- OpenAI Realtime API
- Real-time voice interaction
- Function/tool calling
- Dynamic company knowledge injection
- Industry-specific conversation behavior

### Telephony

- Twilio
- Twilio Voice Webhooks
- Twilio Media Streams

### Mobile

- Capacitor
- Android

### Notifications

- OneSignal
- Supabase Edge Functions

## Example Call Flow

A typical roofing-company call could work like this:

```text
Customer calls company
        ↓
BHeard answers
        ↓
Customer asks a question
        ↓
AI answers using that company's knowledge
        ↓
Customer describes a roofing problem
        ↓
AI begins qualification
        ↓
AI collects required information
        ↓
create_lead function is triggered
        ↓
Lead stored in Supabase
        ↓
Lead appears in BHeard
        ↓
Business can follow up with customer
```

## Project Structure

```text
src/
├── app/
│   ├── admin/              # Administrative interface
│   ├── api/
│   │   ├── admin/          # Administration APIs
│   │   ├── notify-new-lead/
│   │   ├── push/
│   │   └── twilio/voice/   # Incoming Twilio voice webhook
│   ├── empresa/            # Business configuration
│   ├── leads/              # Lead management
│   ├── login/
│   └── registro/
│
├── components/
└── lib/

supabase/
└── functions/
    └── notify_new_lead/

dev-server.js               # Next.js + WebSocket development server
voice-ws-server.js          # Voice/AI WebSocket engine
android/                    # Android/Capacitor project
```

## Security

Sensitive credentials are loaded through environment variables and are not committed to the repository.

The project uses server-side credentials for privileged Supabase operations and separates business data using business identifiers.

Required credentials include services such as OpenAI, Supabase and the telephony infrastructure.

## Development

Install dependencies:

```bash
npm install
```

Create a local environment configuration with the required service credentials.

Then start the development server:

```bash
npm run dev
```

The application runs locally on:

```text
http://localhost:3000
```

A public HTTPS/WSS endpoint is required when connecting Twilio Media Streams to a local development environment.

## Project Status

BHeard is a functional prototype / portfolio project.

The core real-time voice pipeline has been restored and tested, including:

- Incoming Twilio call routing
- WebSocket connection
- OpenAI Realtime connection
- Business identification
- Company knowledge injection
- Real-time AI voice response

The project also contains lead creation and notification infrastructure.

Further production work would include broader end-to-end testing, deployment hardening, observability, additional integrations and expanded industry support.

## Why I Built It

BHeard was created to explore how real-time conversational AI can handle the first point of contact between service businesses and their customers.

Instead of building only a chatbot, the goal was to connect AI directly to the existing phone workflow businesses already use and combine the conversation layer with structured lead management.

---

Built by **André Peixoto**