# Use the official Node.js image
FROM node:20

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy the rest of your code
COPY . .

# Expose the port Google will use
EXPOSE 8080

# Start the server
CMD [ "node", "server.js" ]
