# Backend Architecture Blueprint & System Specifications
## Context & System Goals
This document serves as the structural specification for an automated Airbnb AirCover claims management system. The system decouples field data intake from administrative office workflows using unauthenticated, tokenized dynamic links for field staff. It enforces strict structural alignment with Airbnb's automated Resolution Center logic.

## 1. Relational Database Schema (PostgreSQL DDL Reference)

```sql
-- Enums for Lifecycle Tracking
CREATE TYPE incident_status AS ENUM ('draft', 'ready_to_file', 'submitted_to_guest', 'escalated_to_aircover', 'resolved', 'unfeasible');
CREATE TYPE incident_item_status AS ENUM ('link_generated', 'photos_collected', 'documents_pending', 'complete');
CREATE TYPE asset_incident_type AS ENUM ('damage', 'theft');
CREATE TYPE evidence_file_type AS ENUM ('damage_photo_wide', 'damage_photo_closeup', 'theft_empty_space_photo', 'original_purchase_receipt', 'replacement_retail_quote', 'handyman_invoice', 'police_report');

-- Master Claims Table (1:1 with Reservation)
CREATE TABLE incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL UNIQUE, -- Strict 1:1 Airbnb compliance constraint
    status incident_status NOT NULL DEFAULT 'draft',
    is_emergency_mode BOOLEAN NOT NULL DEFAULT FALSE,
    placeholder_total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    final_payout_requested DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    resolution_center_submitted_at TIMESTAMP WITH TIME ZONE NULL,
    guest_response_deadline_at TIMESTAMP WITH TIME ZONE NULL, -- resolution_center_submitted_at + 24 hrs
    aircover_escalation_deadline_at TIMESTAMP WITH TIME ZONE NOT NULL, -- Checkout + 30 days
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Affected Line-Item Assets Table
CREATE TABLE incident_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL, -- Linked to existing Global Assets table
    type asset_incident_type NOT NULL,
    status incident_item_status NOT NULL DEFAULT 'link_generated',
    cleaner_token VARCHAR(64) NOT NULL UNIQUE, -- Tokenized routing identifier
    token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL, -- created_at + 12 hrs max
    estimated_placeholder_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    description_by_cleaner TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Media and Financial Document Records
CREATE TABLE claim_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_item_id UUID NOT NULL REFERENCES incident_items(id) ON DELETE CASCADE,
    evidence_type evidence_file_type NOT NULL,
    file_url TEXT NOT NULL, -- CDN / S3 Bucket storage reference path
    exif_captured_at TIMESTAMP WITH TIME ZONE NULL, -- Legally extracted pre-checkin validation token
    exif_latitude DECIMAL(9,6) NULL,
    exif_longitude DECIMAL(9,6) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## 2. Dynamic Workflow & Core API State Triggers

```
                       [Incident Generated: Status = 'draft']
                                         │
                                         ▼
                     [All Items: status = 'photos_collected']
                                         │
                                         ▼
                 [Trigger State Update: Incident = 'ready_to_file']
                                         │
                                         ▼
               [Host Submits on Airbnb: Input resolution_submitted_at]
                                         │
                                         ▼
             [Set guest_deadline_at (+24h) & Incident = 'submitted_to_guest']
```

### State Machine Logic
*   **Trigger A (Feasibility Calculation):** Upon incident creation, compute: `is_emergency_mode = (Next_Guest_Checkin_Profile_Time - NOW() < Interval '4 hours')`. If `NOW() > (Previous_Guest_Checkout_Time + Interval '14 days')` OR `NOW() > Next_Guest_Checkin_Profile_Time`, throw an automated unfeasible policy block.
*   **Trigger B (Sub-item Aggregation):** When any entry inside `incident_items` transitions to `'photos_collected'`, evaluate if all siblings matching that `incident_id` are no longer in `'link_generated'`. If true, automatically toggle the master record to `'ready_to_file'`.
*   **Trigger C (The Clock Stopper):** When the host invokes the confirmation endpoint, update the status to `'submitted_to_guest'`, update `resolution_center_submitted_at = NOW()`, and calculate `guest_response_deadline_at = NOW() + Interval '24 hours'`.

## 3. Required Endpoints Spec
*   `POST /api/v1/incidents/create` -> Triage calculation, initializes state, flags emergency settings.
*   `GET /api/v1/field/ingest/:token` -> Returns baseline metadata and the target item's **Previous Stay's Turnover Photo URL** for overlay framing. Completely stripped of guest identities or financial metrics.
*   `POST /api/v1/field/ingest/:token/submit` -> Files binary image metadata, runs EXIF extraction background job, flushes token validity.
*   `POST /api/v1/incidents/:id/confirm-airbnb-filing` -> Commences the 24-hour countdown clock engine.
