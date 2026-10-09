/**
 * socketManager.ts
 * Shared singleton that tracks which users are currently connected via WebSocket.
 * This allows any service module to check online status without coupling to server.ts.
 */

// Map of userId -> true (only connected users are stored)
const connectedUsers: Map<string, boolean> = new Map();

/**
 * Mark a user as online (called when their socket connects / joins a room).
 */
export const setUserOnline = (userId: string): void => {
  // console.log("Marking user online:", userId);
  connectedUsers.set(userId, true);
};

/**
 * Mark a user as offline (called when their socket disconnects).
 */
export const setUserOffline = (userId: string): void => {
  console.log("Marking user offline:", userId);
  connectedUsers.delete(userId);
};

/**
 * Check whether a user is currently connected via WebSocket.
 */
export const isUserOnline = (userId: string): boolean => {
  // console.log("Checking if user is online:", userId);
  // console.log(connectedUsers, "connectedUsers");

  return connectedUsers.has(userId) && connectedUsers.get(userId) === true;
};
