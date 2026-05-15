FROM emscripten/emsdk:3.1.74

RUN apt-get update && apt-get install -y --no-install-recommends \
    autoconf \
    automake \
    libtool \
    pkg-config \
    sox \
    netpbm \
    libtiff-tools \
    libtiff-dev \
    libjpeg-dev \
    libsndfile1-dev \
    bc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY Makefile Makefile
COPY scripts/ scripts/
COPY src/c/ src/c/

RUN chmod +x scripts/*.sh
