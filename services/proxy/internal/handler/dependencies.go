package handler

import (
	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/tokenctx"
	"github.com/getcustoms/proxy/internal/wal"
)

// Dependencies groups the long-lived collaborators shared by ecosystem
// handlers so constructor signatures stay stable as the request pipeline grows.
type Dependencies struct {
	DecisionCache        *cache.Cache
	TokenContextCache    *tokenctx.Cache
	PackageMetadataCache *metadata.Cache
	ContributorCache     *metadata.ContributorCache
	SignalDedupe         *metadata.SignalDedupe
	ControlPlane         *client.Client
	WAL                  *wal.WAL
}
