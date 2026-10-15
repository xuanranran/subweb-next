FROM metacubex/mihomo:Alpha AS kernel
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs ./
COPY LICENSE ./LICENSE
COPY --from=kernel /mihomo /usr/local/bin/mihomo-alpha
COPY --from=kernel /root/.config/mihomo/ /opt/geodata/
ENV MIHOMO_BIN=/usr/local/bin/mihomo-alpha MIHOMO_GEODATA_DIR=/opt/geodata VALIDATOR_HOST=0.0.0.0
USER node
EXPOSE 25501
CMD ["node", "server.mjs"]
