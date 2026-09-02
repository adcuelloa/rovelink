import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

import type { ConceptNodeData } from './toFlow.ts';

export function ConceptFlowNode({ id, data, selected }: NodeProps & { data: ConceptNodeData }) {
  return (
    <div
      className="rl-node"
      data-layer={data.layer}
      data-selected={selected ? 'true' : 'false'}
      data-dimmed={data.dimmed ? 'true' : 'false'}
      data-node-id={id}
      role="button"
      tabIndex={0}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="rl-node__title">{data.title}</div>
      <div className="rl-node__footer">
        <span style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.62rem', opacity: 0.5 }}>
          {data.layer}
        </span>
        {data.sourceCount > 0 && <span className="src-badge">SRC {data.sourceCount}</span>}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
