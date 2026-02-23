import React from 'react';
import { Box, Text } from 'ink';

interface TableProps {
  headers: string[];
  rows: string[][];
  widths: number[];
}

export function Table({ headers, rows, widths }: TableProps) {
  return (
    <Box flexDirection="column">
      <Box>
        {headers.map((header, i) => (
          <Box key={i} width={widths[i]}>
            <Text bold>{header}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx}>
          {row.map((cell, cellIdx) => (
            <Box key={cellIdx} width={widths[cellIdx]}>
              <Text>{cell}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function formatDate(unixMs: number): string {
  const d = new Date(unixMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
