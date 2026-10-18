// The only place the connect and approve pages keep addresses.
// The same addresses live in two other single places: supabase/functions/_shared/agent_config.ts
// and App/Agents/AgentLinks.swift in the Daytray app repo.
window.DAYTRAY_AGENT = {
  issuer: "https://jxbgtenokhjatncgdqsb.supabase.co/functions/v1/agent-oauth",
  approveLink: "https://bluewavecreative.github.io/daytray/approve"
};
