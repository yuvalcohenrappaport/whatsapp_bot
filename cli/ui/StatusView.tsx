import React from 'react';
import { Box, Text } from 'ink';

interface StatusViewProps {
  pm2Status: string;
  uptime: number | null;
  memory: number | null;
  contactCount: number;
  groupCount: number;
  draftCount: number;
}

function statusColor(status: string): string {
  if (status === 'online') return 'green';
  if (status === 'stopped' || status === 'errored') return 'red';
  return 'yellow';
}

function formatUptime(ms: number | null): string {
  if (ms === null) return 'N/A';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function formatMemory(bytes: number | null): string {
  if (bytes === null) return 'N/A';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function StatusView({
  pm2Status,
  uptime,
  memory,
  contactCount,
  groupCount,
  draftCount,
}: StatusViewProps) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box>
        <Box width={20}>
          <Text bold>Bot Status:</Text>
        </Box>
        <Text color={statusColor(pm2Status)}>{pm2Status}</Text>
      </Box>
      <Box>
        <Box width={20}>
          <Text bold>Uptime:</Text>
        </Box>
        <Text>{formatUptime(uptime)}</Text>
      </Box>
      <Box>
        <Box width={20}>
          <Text bold>Memory:</Text>
        </Box>
        <Text>{formatMemory(memory)}</Text>
      </Box>
      <Box marginTop={1}>
        <Box width={20}>
          <Text bold>Active Contacts:</Text>
        </Box>
        <Text>{contactCount}</Text>
      </Box>
      <Box>
        <Box width={20}>
          <Text bold>Tracked Groups:</Text>
        </Box>
        <Text>{groupCount}</Text>
      </Box>
      <Box>
        <Box width={20}>
          <Text bold>Pending Drafts:</Text>
        </Box>
        <Text>{draftCount}</Text>
      </Box>
    </Box>
  );
}
