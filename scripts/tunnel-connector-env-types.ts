// TASK-014: structural typing bridge so tunnel code compiles without pulling
// full NodeJS namespace types into small helper modules.
export interface NodeJS_ProcessEnvLike {
  [key: string]: string | undefined;
}

export type ConnectorEnvSource = NodeJS_ProcessEnvLike;