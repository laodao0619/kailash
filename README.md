# Kailash Energy AI Knowledge Hub

Feishu-first internal knowledge and operations assistant for Kailash Energy.

## Architecture
- Feishu Open Platform: Wiki, Docs, Bitable, group bot messaging
- Vercel: API gateway and serverless endpoints
- OpenAI API: assistant reasoning and tool orchestration
- Feishu remains the system of record for business documents and structured records

## Safety
- Never commit secrets or tokens.
- Preserve the existing CRM report gateway until the new API is verified.
- Use a separate deployment/project or branch for knowledge hub APIs.
- All write operations must be auditable.
