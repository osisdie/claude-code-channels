FROM oven/bun:1-alpine

RUN apk add --no-cache bash git curl nodejs npm \
    && npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY . .

ENTRYPOINT ["./start.sh"]
CMD ["teams"]
