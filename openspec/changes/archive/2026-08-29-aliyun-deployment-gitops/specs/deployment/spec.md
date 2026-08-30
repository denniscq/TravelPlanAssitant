## Purpose

Defines the production deployment and operations contract for TravelPlanAssistant: the external entry points (HTTPS via Nginx), the application process model (PM2 cluster), the release trigger (GitOps on main branch), and the China mainland domain + ICP-filing sequencing that gates going live.

## ADDED Requirements

### Requirement: HTTPS ingress via Nginx reverse proxy

The production system SHALL expose exactly two public TCP ports (80 and 443), both terminated by Nginx. All HTTP traffic on port 80 SHALL redirect to HTTPS. The Next.js application SHALL listen only on the loopback interface.

#### Scenario: HTTP to HTTPS redirect
- **WHEN** a client requests `http://<domain>/` on port 80
- **THEN** Nginx SHALL respond with HTTP 301
- **AND** the `Location` header SHALL be `https://<domain>/`

#### Scenario: Next.js not directly reachable from the public internet
- **WHEN** a client attempts to reach the Next.js application on any port other than 80/443
- **THEN** the connection SHALL fail (security group / firewall blocks it)
- **AND** the application SHALL be bound to `127.0.0.1:3000` only

#### Scenario: Forwarded headers preserve client IP
- **WHEN** Nginx proxies a request to the application
- **THEN** it SHALL set `X-Forwarded-For`, `X-Real-IP`, `Host`, and `X-Forwarded-Proto` headers
- **AND** the application SHALL derive the rate-limit key from the real client IP (per the `rate-limiting` capability)

### Requirement: PM2 cluster process model

The production Next.js process SHALL run under PM2 in cluster mode with exactly 2 instances (matching the 2 vCPU host), sharing port 3000. PM2 SHALL auto-restart crashed workers and SHALL restart on host reboot.

#### Scenario: Cluster workers are online
- **WHEN** the application is deployed and healthy
- **THEN** `pm2 status` SHALL report 2 online workers for the `tpa` app
- **AND** both workers SHALL share the single listener on `127.0.0.1:3000`

#### Scenario: Worker crash auto-restart
- **WHEN** a worker process exits unexpectedly
- **THEN** PM2 SHALL restart the worker automatically
- **AND** memory-restart protection SHALL be active at 512 MB per worker

#### Scenario: Host reboot restores service
- **WHEN** the server reboots
- **THEN** PM2 SHALL automatically start the `tpa` app (systemd startup hook)
- **AND** Nginx SHALL also start automatically

### Requirement: GitOps release pipeline

A push to the `main` branch of the GitHub repository SHALL trigger an automated pipeline: a CI gate runs first, and only when it passes is the server deployment executed.

#### Scenario: CI gate blocks deployment on failure
- **WHEN** a push to `main` triggers the pipeline
- **THEN** the CI job SHALL run `npm test` (all tests), `npx tsc --noEmit`, and `npm run build`
- **AND** if any step fails, the deployment job SHALL NOT run

#### Scenario: Deployment executes on green
- **WHEN** the CI gate passes
- **THEN** the deployment job SHALL SSH to the server, pull `main`, install dependencies, build, and reload the PM2 cluster with zero downtime

#### Scenario: Overlapping deployments are serialized
- **WHEN** two pushes to `main` happen in quick succession
- **THEN** the pipeline SHALL queue them with a concurrency guard
- **AND** they SHALL NOT run deployment simultaneously

### Requirement: Environment secrets stay out of the repository

Runtime secrets (AMap keys, LLM keys) SHALL NOT be committed to the repository. They SHALL live only in the server-side `.env.local` file, which the deployment process SHALL NOT overwrite.

#### Scenario: Deployment preserves server-side env
- **WHEN** the deployment script runs `git reset --hard origin/main`
- **THEN** the server-side `.env.local` file SHALL remain unchanged
- **AND** the application SHALL restart with the existing environment

#### Scenario: GitHub Secrets hold deployment credentials
- **WHEN** the pipeline needs to SSH to the server
- **THEN** it SHALL read host, username, and private key from GitHub Secrets (`ALIYUN_HOST`, `ALIYUN_USER`, `ALIYUN_SSH_KEY`)
- **AND** those secrets SHALL be readable only by repository maintainers, not by forks

### Requirement: China mainland domain and ICP-filing gate

To make a custom domain reachable in mainland China, the system SHALL follow a strict sequencing: the ICP filing MUST be approved before the domain resolves to the server and before ports 80/443 open publicly.

#### Scenario: Ports remain closed during ICP review
- **WHEN** an ICP filing is in review (up to 20 days)
- **THEN** ports 80 and 443 SHALL remain closed in the security group
- **AND** the domain SHALL NOT resolve to the server

#### Scenario: Go-live after filing approval
- **WHEN** the ICP filing is approved and the domain resolves to the server
- **THEN** ports 80/443 SHALL be opened
- **AND** a Let's Encrypt certificate SHALL be issued for the domain and its `www` subdomain
- **AND** the filing number SHALL be displayed in the site footer

#### Scenario: TLS auto-renewal
- **WHEN** the Let's Encrypt certificate approaches expiry (60-day interval)
- **THEN** certbot SHALL automatically renew it
- **AND** the site SHALL remain reachable over HTTPS without manual intervention
