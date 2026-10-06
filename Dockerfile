FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV PORT=8787 HOST=0.0.0.0 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
# df + /proc are available inside the container; mount the host's disks read-only to report them:
#   -v /:/host/root:ro -v /mnt:/host/mnt:ro  and  DISK_ROOT=/host/root DISK_MNT=/host/mnt
CMD ["node", "server/server.js"]
