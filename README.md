# 🌊 FloodSAHAAY — Real-Time Flood Mapping & Emergency Response System

**FloodSAHAAY** is a full-stack, data-driven web application designed for real-time flood monitoring, hydrologic flood risk scoring, dynamic evacuation routing, emergency SOS dispatching, and offline P2P emergency mesh networking. Built for the Smart India Hackathon (SIH), it combines live meteorological telemetry, soil moisture analytics, and geographic vulnerability modeling to protect communities before floodwaters rise.

---

## 🛠️ Full Technology Stack

### 🎨 Frontend
- **Languages**: HTML5 (Semantic markup), CSS3 (Custom design tokens & responsive layouts), Vanilla JavaScript (ES6+ modular SPA architecture)
- **Design & Styling**: Vanilla CSS with Design System Tokens, Dark mode / Glassmorphism UI, 3D interactive tilt cards, fluid typography (`clamp()`), micro-animations
- **Interactive Maps**: [Leaflet.js v1.9.4](https://leafletjs.com/) with OpenStreetMap vector tiles & spatial perimeter rendering
- **Data Visualization**: Custom HTML5 2D Canvas rendering for live precipitation trend graphs
- **Browser APIs**: Web Geolocation API, Clipboard API, Fetch API, SessionStorage / LocalStorage API

### ⚙️ Backend & Database
- **Runtime Environment**: [Node.js](https://nodejs.org/)
- **Web Framework**: [Express.js](https://expressjs.com/) (RESTful HTTP Routing, middleware pipeline, static web server)
- **Database & Data Modeling**: [MongoDB](https://www.mongodb.com/) & [Mongoose ODM](https://mongoosejs.com/) (with automatic fallback to In-Memory storage if MongoDB is offline)
- **Authentication & Security**: JSON Web Tokens ([JWT](https://jwt.io/)) for session authorization, [bcryptjs](https://github.com/dcodeIO/bcrypt.js) for password hashing
- **Middleware & Utility**: `cors` (Cross-Origin Resource Sharing), `dotenv` (Environment variable configuration)

### 📡 Live Data Sources & Third-Party APIs
- **[Open-Meteo Weather API](https://open-meteo.com/)**: Live meteorological telemetry (precipitation intensity, 24h accumulated rainfall, surface temperature, wind speed, 0–1cm topsoil moisture).
- **[OpenStreetMap Nominatim API](https://nominatim.openstreetmap.org/)**: Forward and reverse geocoding engine for location lookup across India.

### 🚨 Emergency & Spatial Engines
- **P2P Mesh Network Protocol**: Simulated short-range (300m–400m) BLE / Wi-Fi Direct peer discovery, signal relay nodes, and distress beacon broadcasts for offline operation.
- **Spatial Distance Engine**: Haversine formula calculation for hyper-local shelter distance ranking and travel time estimates.

---

## 📁 Full Project Folder Structure

```text
FloodSAHAAY/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── db.js                 # MongoDB connection configuration & fallback handling
│   │   ├── controllers/
│   │   │   └── auth.controller.js    # Authentication logic (Signup, Login, OTP verification)
│   │   ├── middleware/
│   │   │   └── auth.middleware.js    # JWT token authentication middleware for protected routes
│   │   ├── models/
│   │   │   ├── User.js               # MongoDB Mongoose Schema for Users
│   │   │   ├── Contact.js            # Mongoose Schema for Emergency Contacts
│   │   │   ├── Alert.js              # Mongoose Schema for System Notifications & Alerts
│   │   │   └── Shelter.js            # Mongoose Schema for Evacuation Shelters
│   │   ├── routes/
│   │   │   ├── auth.routes.js        # Auth endpoint router (/api/auth)
│   │   │   ├── floodRisk.routes.js   # Open-Meteo & Regional Hydrologic Vulnerability Engine (/api/flood-risk)
│   │   │   ├── weather.routes.js     # Live meteorological forecast router (/api/weather)
│   │   │   ├── location.routes.js    # OpenStreetMap Nominatim reverse & forward geocoding (/api/locations)
│   │   │   ├── shelters.routes.js    # Hyper-local evacuation shelter distance engine (/api/shelters)
│   │   │   ├── contacts.routes.js    # Emergency contacts CRUD router (/api/contacts)
│   │   │   ├── sos.routes.js         # Emergency SOS broadcast dispatcher (/api/sos)
│   │   │   ├── notifications.routes.js # User notifications & mark-all-read router (/api/notifications)
│   │   │   └── profile.routes.js     # User profile settings router (/api/profile)
│   │   ├── services/
│   │   │   └── (Helper services for SMS/email dispatches)
│   │   └── app.js                    # Express application setup, middleware & route registrations
│   ├── .env.example                  # Environment variables template
│   ├── package.json                  # Backend dependencies & npm scripts
│   └── server.js                     # Main server entry point & HTTP daemon listener
│
└── frontend/
    ├── css/
    │   ├── base.css                  # Color tokens, typography, CSS resets, global overflow protection
    │   ├── components.css            # Buttons, forms, cards, badges, fluid typography clamp rules
    │   ├── layout.css                # Grid systems, sticky header, navigation layout, responsive queries
    │   ├── landing.css               # Hero split layout & floating risk card positioning
    │   ├── dashboard.css             # Dashboard SPA styles, map overlays, animated gauge, mobile drawer
    │   └── auth.css                  # Signin & Register split-panel styles & mobile responsive tweaks
    ├── js/
    │   ├── services/
    │   │   ├── api.js                # Core Fetch API HTTP client with JWT Authorization headers
    │   │   └── auth.service.js       # LocalStorage token management & auth guard helper
    │   └── pages/
    │       ├── dashboard.js          # Master SPA controller (Maps, Gauges, Canvas Graph, Contacts, Shelters, Mesh)
    │       ├── signin.js             # Signin form handler & API submission
    │       └── register.js           # Registration & 2FA OTP verification handler
    ├── pages/
    │   ├── dashboard.html            # Main SPA Dashboard (Overview, Map, Alerts, Emergency, Safety, Shelters)
    │   ├── signin.html               # Sign In page
    │   ├── register.html             # Account Sign Up page
    │   ├── register-otp.html         # OTP verification page
    │   ├── location-setup.html       # Initial location selection onboarding page
    │   ├── profile.html              # Profile & emergency settings page
    │   └── how-it-works.html         # Platform architecture & workflow explanation page
    ├── assets/                       # Static branding icons & imagery
    └── index.html                    # Public Landing Page with live risk map & quick actions
```

---

## 🔍 Detailed File Functionality ("Which File Does What")

### 🖥️ Frontend Files

#### Pages (HTML)
* **`frontend/index.html`**: Public landing page featuring live risk score badge, interactive Leaflet map canvas with OpenStreetMap tiles, hero messaging, and quick portal links.
* **`frontend/pages/dashboard.html`**: Master Single Page Application (SPA) dashboard containing 6 core tabs:
  1. **Overview**: Live risk score gauge (0–100), rainfall/soil saturation progress bars, interactive mini-map, weather metrics grid, high-res canvas precipitation bar chart.
  2. **Map**: Fullscreen Leaflet map canvas with clickable location selector and floating risk overlay.
  3. **Alerts**: Active flood alert list with unread notification badge counter and *"Mark all as read"* action.
  4. **Emergency**: Hold-to-activate 2-second SOS button, Emergency Contacts sidebar, and **300m–400m Offline P2P Emergency Mesh Network**.
  5. **Safety**: Connected Safety Circle members, Safety Map canvas, and interactive Safety Circle Invite Modal.
  6. **Shelters**: Live evacuation shelter map with polyline route navigation and capacity progress meters.
* **`frontend/pages/signin.html`**: Responsive authentication split-panel for account sign-in.
* **`frontend/pages/register.html`**: Account sign-up form with phone number formatting and 2FA trigger.
* **`frontend/pages/register-otp.html`**: OTP verification code input page.
* **`frontend/pages/profile.html`**: Profile management page allowing users to update their name, phone number, and emergency alert preferences.
* **`frontend/pages/how-it-works.html`**: Interactive 6-step architecture and workflow explanation page.

#### Stylesheets (CSS)
* **`frontend/css/base.css`**: Defines Figma design system tokens (colors, borders, shadows, radii), global CSS resets, and mobile overflow constraints (`overflow-x: hidden`).
* **`frontend/css/components.css`**: Reusable component styles including touch-friendly buttons (`min-height: 44px`), input fields, cards, status badges, and fluid typography (`clamp()`).
* **`frontend/css/layout.css`**: Grid layout definitions (`split-layout`, `dashboard-layout`), sticky header navigation, and breakpoint queries.
* **`frontend/css/dashboard.css`**: Dashboard SPA styling, mobile drawer menu (`z-index: 99999`), floating map overlay cards, gauge marker transitions (`#risk-marker`), and SOS pulse animations.
* **`frontend/css/landing.css`**: Hero split layout styling and responsive map overlay positioning for the main landing page.
* **`frontend/css/auth.css`**: Auth brand panel styling and mobile view rules.

#### JavaScript (JS)
* **`frontend/js/services/api.js`**: Universal HTTP wrapper (`ApiService.get`, `post`, `put`, `delete`) automatically injecting `Authorization: Bearer <token>` headers.
* **`frontend/js/services/auth.service.js`**: Manages JWT session state, LocalStorage tokens, user data cache, and authentication route guarding.
* **`frontend/js/pages/dashboard.js`**: Master frontend engine managing state transitions, Leaflet map initializations, Open-Meteo telemetry fetching, Canvas precipitation bar chart drawing, contact CRUD, shelter distance calculation, and P2P Mesh interactions.
* **`frontend/js/pages/signin.js`**: Handles sign-in form validation, API authentication requests, and redirection.
* **`frontend/js/pages/register.js`**: Manages signup registration and OTP modal verification.

---

### ⚙️ Backend Files

#### Core Server Setup
* **`backend/server.js`**: Express server bootstrap script listening on port `5000` (or `process.env.PORT`).
* **`backend/src/app.js`**: Express app initialization, CORS configuration, static asset serving (`/frontend`), JSON body parsing, and API route mapping (`/api/*`).
* **`backend/src/config/db.js`**: MongoDB connection handler with graceful fallback to in-memory standalone mode when MongoDB is offline.

#### Controllers & Middleware
* **`backend/src/controllers/auth.controller.js`**: Core authentication logic managing user registration, password hashing (bcrypt), JWT token generation, and OTP verification code generation.
* **`backend/src/middleware/auth.middleware.js`**: Protects API endpoints by verifying incoming JWT bearer tokens.

#### Database Models (Mongoose)
* **`backend/src/models/User.js`**: User account schema storing name, email, hashed password, phone number, and location preferences.
* **`backend/src/models/Contact.js`**: Emergency contact schema storing contact name, relationship, phone, and email.
* **`backend/src/models/Alert.js`**: System notification schema storing alert title, type (`flood_alert`, `sos_alert`), body text, and read status.
* **`backend/src/models/Shelter.js`**: Evacuation shelter schema storing name, address, latitude, longitude, capacity, and current occupancy.

#### Express API Routes
* **`backend/src/routes/floodRisk.routes.js`**: **Hydrologic Flood Risk Engine**. Fetches live Open-Meteo precipitation and topsoil moisture data, then computes a 0–100 Flood Risk Score using the **Regional Hydrologic Vulnerability Model (HVI)**.
* **`backend/src/routes/weather.routes.js`**: Endpoint serving raw Open-Meteo hourly/daily forecast data.
* **`backend/src/routes/location.routes.js`**: Connects to OpenStreetMap Nominatim API for forward/reverse geocoding and quick location searches across India.
* **`backend/src/routes/shelters.routes.js`**: Calculates distance and drive times from the user's location to evacuation shelters dynamically using the Haversine formula.
* **`backend/src/routes/contacts.routes.js`**: Full CRUD endpoints (`GET`, `POST`, `PUT`, `DELETE`) for user emergency contacts.
* **`backend/src/routes/sos.routes.js`**: Dispatches emergency SOS distress broadcasts with live GPS coordinates.
* **`backend/src/routes/notifications.routes.js`**: Serves active alerts and handles `PUT /read-all` requests to clear unread alert counters.
* **`backend/src/routes/profile.routes.js`**: Provides profile fetching (`GET /api/profile/me`) and profile detail updating (`PUT /api/profile/me`).

---

## ⚡ Core Technical Features & Algorithms

### 1. 🌊 Regional Hydrologic Vulnerability Model (HVI)
Located in [`floodRisk.routes.js`](file:///backend/src/routes/floodRisk.routes.js), this engine evaluates geographical vulnerability alongside live weather data:
- **Brahmaputra Basin (Guwahati, Assam)**: Assigned a **+62 base vulnerability index**, accurately computing a **83 / Critical Flood Risk** during monsoon catchment periods.
- **Gangetic Urban Plains (Lucknow, UP)**: Assigned a **+12 base vulnerability index**, accurately computing a **24 / Low Flood Risk** during dry periods.

### 2. 🏠 Hyper-Local Dynamic Evacuation Shelters
Located in [`shelters.routes.js`](file:///backend/src/routes/shelters.routes.js), this route dynamically generates and ranks shelters relative to the user's active coordinates (`userLat`, `userLng`), guaranteeing hyper-local proximity (**1.0 km – 2.5 km away**, ~3 to 8 min drive) anywhere in India.

### 3. 📡 Offline P2P Emergency Mesh Network (Range: 300m – 400m)
Located in [`dashboard.html`](file:///frontend/pages/dashboard.html) and [`dashboard.js`](file:///frontend/js/pages/dashboard.js), this feature enables survivors stuck in floods to discover active nearby peers (`Node #FS-942`, `Node #FS-318`) within 300m–400m range via simulated BLE & Wi-Fi Direct radio, broadcast distress beacons, and send peer pings without cellular internet.

---

## 🌟 Tier 4: Crowdsourced Ground Truth Engine

### 1. ⚠️ Citizen Flood Reports (`/api/reports`)
- **Offline-First Submission**: Reports submitted while offline are queued in `localStorage` (`floodsahaay_queued_reports`) and automatically synchronized once network connectivity resumes via the `online` event listener.
- **Visual Evidence**: Accepts optional photo attachments (validated up to 1.5 MB data URL) providing a **+10 confidence boost**.
- **Consensus Scoring & Decay**:
  - Base Score: `40 points`
  - Photo bonus: `+10 points`
  - Nearby Confirmation: `+15 points` per local verification within 2 km
  - Dispute penalty: `-20 points` per local dispute
  - User Reputation Adjustment: `+10 points` for majority-verified track records, `-15 points` for majority-disputed history.
  - Linear Time Decay: Decays smoothly over type-specific TTL (Water level: 6h, Road blocked: 12h, Need help: 3h, Bridge damaged: 8h).
  - Anti-Spam: Shadow-rate limiting throttling users with >3 disputed reports; duplicate suppression for identical hazard types submitted within 100 meters within 15 minutes.

### 2. 🗺️ Live Hazard Map & Evacuation Route Safety
- **Visual Confidence Coding**:
  - High Confidence (Score ≥ 70): Solid emerald border (`#10B981`)
  - Emerging / Unverified (40–69): Dashed amber border (`#F59E0B`)
  - Stale / Disputed (< 40): Faded grey border (`#9CA3AF`)
- **Route Hazard Detection**: Evacuation routes to shelters perform a vector point-to-segment proximity scan. If any reported hazard lies within **150 meters** of the evacuation corridor, the dashboard displays a warning banner and styles the route polyline in caution red.
- **Hydrologic Risk Signal**: When ≥3 verified water reports exist within 3 hours in a 10 km radius, a `crowdSignal` bonus (+5 to +15 pts) is dynamically incorporated into the calculated flood risk score.

### 3. 🛡️ "I'm Safe" Check-ins & Public Tracking (`/api/checkins`, `/api/share/:token`)
- One-tap check-in buttons (`I'm Safe`, `Evacuating`, `Need Help`) immediately update user status and notify safety circle contacts.
- **Battery Status API Integration**: Monitors device battery level. When `< 15%` and not connected to a charger, automatically prompts the user to broadcast their last known location before shutdown.
- **Public 24-Hour Share Link**: Generates a secure, rate-limited public tracking URL (`/pages/share.html?token=...`) allowing loved ones outside the flood zone to view live coordinates, battery level, and safety status without an account.

---

## 🏛️ Tier 5: Authority & Relief Operations System

### 1. 👥 Multi-Role Authorization & Access Control
User roles are authenticated via signed JWTs and enforced by `requireRole(...)` middleware:
- `citizen`: Report hazards, check-in, request help, file damage claims.
- `volunteer`: Set readiness status, review nearby requests, accept rescue tasks.
- `shelter_manager`: Mobile-friendly shelter occupancy controls and supply tracking.
- `responder`: Full triage authority, dispatch responders, view live telemetry.
- `admin`: Full system control, role elevation, broadcast alerts, CSV export.

### 2. 🚨 Command Center Dashboard (`/pages/admin.html`)
- **Real-Time SSE Stream**: Live Server-Sent Events at `/api/admin/stream` dispatch immediate telemetry on SOS bursts, new hazard reports, volunteer claims, and shelter updates.
- **Prioritized Triage Queue**: Unifies SOS beacons, crowd reports, and help requests with status badges, urgency levels, and full audit logging (`/api/admin/incidents/:id/logs`).
- **Emergency Broadcasts**: Authorities can publish high-priority alerts across designated districts.
- **Data Export**: One-click CSV export of incident records for disaster management debriefs.

### 3. 🏠 Shelter Operations Manager (`/pages/shelter-manager.html`)
- Mobile touch-optimized interface for shelter managers at evacuation grounds.
- Fast increment/decrement touch counters (`+1`, `-1`, `+5`, `-5`).
- Multi-resource supply status toggles (`Food`, `Water`, `Medical`, `Blankets`) with `OK`, `LOW`, and `OUT` states.

### 4. 🤝 Volunteer & Help Request Dispatch Engine
- **Vulnerability-Aware Matching**: Evaluates volunteer-request affinity using a weighted scoring formula:
  $$\text{Score} = (\text{Skill Match} \times 0.4) + (\text{Proximity} \times 0.3) + (\text{Availability} \times 0.2) + (\text{Language} \times 0.1)$$
- **Race-Safe Task Claiming**: Atomic acceptance checks prevent multiple volunteers from double-claiming the same urgent rescue task (returns `409 Conflict` if already claimed).

### 5. 📑 Post-Flood Recovery & Health Advisory
- **Damage Assessment Claims (`/api/damage`)**: File official compensation claims with loss estimates in INR (₹), damaged asset categories, and photo evidence.
- **Risk-Aware Health Protocol**: Offline-accessible guidance for water purification, waterborne epidemic prevention (leptospirosis, cholera), electrical hazards, and official helplines (NDMA 1078, Emergency 112).

---

## 🔑 Demo Login Accounts

Pre-seeded demo credentials for instant testing (Password for all: `Password123!`):

| Role | Email | Password | Access Capabilities |
| :--- | :--- | :--- | :--- |
| **Command Admin** | `admin@floodsahaay.local` | `Password123!` | `/pages/admin.html` (Full Command Center, SSE stream, CSV export, broadcasts) |
| **Emergency Responder** | `responder@floodsahaay.local` | `Password123!` | `/pages/admin.html` (Triage actions, dispatch teams, audit trail) |
| **Shelter Manager** | `shelter@floodsahaay.local` | `Password123!` | `/pages/shelter-manager.html` (Live capacity meter, touch counters, supplies) |
| **Field Volunteer (Rescue)** | `volunteer1@floodsahaay.local` | `Password123!` | Dashboard `#volunteers` tab (Readiness toggles, claim rescue tasks) |
| **Medical Volunteer** | `volunteer2@floodsahaay.local` | `Password123!` | Dashboard `#volunteers` tab (Medical first aid dispatch) |
| **Citizen** | `citizen@floodsahaay.local` | `Password123!` | Dashboard (Reports, Check-ins, Public Share, Recovery claims) |

---

## 🚀 How to Run the Project

### Prerequisites
- **Node.js**: v16+ installed.
- **npm**: v8+ installed.
- **MongoDB** *(Optional)*: If MongoDB is running locally on port `27017`, the server connects automatically. If MongoDB is off, the backend runs seamlessly in **Standalone In-Memory Mode**.

### Step 1: Install Dependencies
Navigate to the `backend` directory and install dependencies:
```bash
cd backend
npm install
```

### Step 2: Start the Backend Server
Run the Express backend server:
```bash
npm start
# OR for development:
node server.js
```
The server will start on **`http://localhost:5000`** and serve both backend REST APIs (`/api/*`) and frontend static web pages (`/frontend/*`).

### Step 3: Run Automated Test Suites
Run the unit test for consensus scoring and decay:
```bash
node backend/scripts/test-report-scoring.js
```
Run the end-to-end integration test suite verifying all Tier 4 & 5 routes:
```bash
node backend/scripts/test-e2e-tier4-tier5.js
```

### Step 4: Open Application in Web Browser
Open your browser and navigate to:
```text
http://localhost:5000/index.html
```
- **Main Dashboard**: `http://localhost:5000/pages/dashboard.html`
- **Command Center (Admin/Responder)**: `http://localhost:5000/pages/admin.html`
- **Shelter Manager Operations**: `http://localhost:5000/pages/shelter-manager.html`
- **Public Location Tracking**: `http://localhost:5000/pages/share.html`

---

## 🛡️ License
Built for Smart India Hackathon (SIH) Internal Project. All rights reserved.

