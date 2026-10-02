export interface StreamChatAuthor {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

export interface StreamChatMessage {
  id: string;
  streamerDid: string;
  author: StreamChatAuthor;
  text: string;
  createdAt: string;
}
