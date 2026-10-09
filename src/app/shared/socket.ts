import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer;

export const setIO = (socketIO: SocketIOServer) => {
  io = socketIO;
};

export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error("Socket.IO has not been initialized");
  }
  return io;
};
