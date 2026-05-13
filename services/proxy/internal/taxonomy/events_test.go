package taxonomy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

type eventTaxonomyFixture struct {
	RequestEventTypes     []string `json:"requestEventTypes"`
	DecisionPaths         []string `json:"decisionPaths"`
	ServeModes            []string `json:"serveModes"`
	MetadataCacheStatuses []string `json:"metadataCacheStatuses"`
	ProxyStatusEventTypes []string `json:"proxyStatusEventTypes"`
}

func TestEventTaxonomyMatchesSharedSource(t *testing.T) {
	path := filepath.Join("..", "..", "..", "shared", "taxonomy", "events.json")
	raw, err := os.ReadFile(path)
	require.NoError(t, err)

	var fixture eventTaxonomyFixture
	require.NoError(t, json.Unmarshal(raw, &fixture))

	require.Equal(t, fixture.RequestEventTypes, RequestEventTypes)
	require.Equal(t, fixture.DecisionPaths, DecisionPaths)
	require.Equal(t, fixture.ServeModes, ServeModes)
	require.Equal(t, fixture.MetadataCacheStatuses, MetadataCacheStatuses)
	require.Equal(t, fixture.ProxyStatusEventTypes, ProxyStatusEventTypes)
}
