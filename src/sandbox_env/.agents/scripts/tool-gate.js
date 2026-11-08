#!/usr/bin/env node
/**
 * PreToolUse Hook Gate for Gapless Sandbox
 * Strictly blocks all shell execution, file writes, subagents, or unauthorized reads.
 * Only allows read_file/view_file on files inside the uploads directory for visual inspection.
 */
const path = require('path');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input || '{}');
    const toolName = (payload.toolCall && payload.toolCall.name) ? String(payload.toolCall.name).toLowerCase() : '';
    const args = (payload.toolCall && payload.toolCall.args) || {};

    // Allow read_file / view_file ONLY if reading a client uploaded image inside UPLOADS_DIR
    if (toolName === 'read_file' || toolName === 'view_file') {
      const targetPath = args.Path || args.path || args.FilePath || '';
      const resolved = path.resolve(String(targetPath));
      const allowedPrefix = "/home/pluto/projects/Gapless/src/uploads";
      if (resolved.startsWith(allowedPrefix + path.sep)) {
        process.stdout.write(JSON.stringify({
          decision: 'allow',
          reason: 'Allowed read-only visual inspection of client uploaded media.'
        }));
        process.exit(0);
      }
    }

    // Hard deny everything else
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      reason: 'SECURITY POLICY: You are solely a requirements discovery consultant. Executing commands, modifying files, or using unauthorized tools is strictly forbidden.'
    }));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      reason: 'Blocked by Gapless Sandbox Security Hook.'
    }));
  }
});
