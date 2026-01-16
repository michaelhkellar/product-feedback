# n8n-nodes-blumira

Community node for the Blumira Public API in n8n.

## Features

- Health checks for the Blumira API
- MSP account listing and details
- MSP account findings, comments, agent devices, and agent keys
- Organization findings, comments, details, agent devices, and agent keys
- Pax8 provision requests

## Installation

Install the community node package in the same environment as n8n.

1. Install via npm.

   npm install n8n-nodes-blumira

2. Restart n8n.

## Credentials

Create a `Blumira API` credential with the following fields:

- `Access Token`: JWT access token for Bearer authentication.
- `Pax8 API Token`: optional token for Pax8 provision endpoints.

## Resources and operations

- Account (MSP)
  - Get
  - Get Many
  - Get Findings
  - Get Findings (All Accounts)
  - Get Finding
  - Get Finding Comments
  - Get Agent Devices
  - Get Agent Device
  - Get Agent Keys
  - Get Agent Key
- Agent Device (Org)
  - Get
  - Get Many
- Agent Key (Org)
  - Get
  - Get Many
- Finding (Org)
  - Get
  - Get Many
  - Get Comments
  - Get Details
- Pax8 Provision
  - Create
- Health
  - Get

## Development

- Build: `npm run build`
- Lint: `npm run lint`
