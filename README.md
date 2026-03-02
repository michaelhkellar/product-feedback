# n8n-nodes-blumira

Community node for the Blumira Public API in n8n.

## Features

- Health checks for the Blumira API
- MSP account listing and details
- MSP account findings, comments, agent devices, and agent keys
- Organization findings, comments, details, agent devices, and agent keys
- Add comments to findings (MSP and Org)
- Assign owners to findings (MSP and Org)
- Resolve findings with configurable resolution types (MSP and Org)

## Installation

Follow the [community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

1. Install via npm in the same environment as n8n.

   npm install n8n-nodes-blumira

2. Restart n8n.

## Credentials

Create a `Blumira API` credential with the following field:

- `Access Token`: JWT access token for Bearer authentication.

## Resources and operations

- Account (MSP)
  - Get
  - Get Many
  - Get Findings
  - Get Findings (All Accounts)
  - Get Finding
  - Get Finding Comments
  - Add Finding Comment (POST)
  - Assign Finding Owners (POST)
  - Resolve Finding (POST)
  - Get Agent Devices
  - Get Agent Device
  - Get Agent Keys
  - Get Agent Key
  - Get Users
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
  - Add Comment (POST)
  - Assign Owners (POST)
  - Resolve (POST)
- Health
  - Get
- Resolution
  - Get Many
- User (Org)
  - Get Many

## Compatibility

- Uses n8n nodes API version 1.
- Requires the same Node.js version supported by your n8n instance.

## Resources

- [Blumira Public API](https://api.blumira.com/public-api/v1/ui/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## Development

- Build: `npm run build`
- Lint: `npm run lint`
