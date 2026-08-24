import { KeyValueList, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@openlinker/web';

export const ConnectionDetail = () => (
  <Tabs defaultValue="overview">
    <TabsList>
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="health">
        Health <span className="tabs__count">3</span>
      </TabsTrigger>
      <TabsTrigger value="actions">Actions</TabsTrigger>
      <TabsTrigger value="config">Config</TabsTrigger>
    </TabsList>

    <TabsContent value="overview">
      <KeyValueList
        items={[
          { id: 'adapter', label: 'Adapter', value: <span className="mono">allegro.publicapi.v1</span> },
          { id: 'platform', label: 'Platform', value: 'allegro' },
          { id: 'status', label: 'Status', value: <StatusBadge tone="success">active</StatusBadge> },
          { id: 'caps', label: 'Capabilities', value: 'OrderSource, OfferManager' },
        ]}
      />
    </TabsContent>

    <TabsContent value="health">
      <p className="muted-text">Last successful poll 4 minutes ago.</p>
    </TabsContent>

    <TabsContent value="actions">
      <p className="muted-text">Trigger a sync job or re-install webhooks.</p>
    </TabsContent>

    <TabsContent value="config">
      <p className="muted-text">Rate limits, stock safety buffer, pricing rule.</p>
    </TabsContent>
  </Tabs>
);

export const ListingsFilters = () => (
  <Tabs defaultValue="invalid">
    <TabsList>
      <TabsTrigger value="all">
        All listings <span className="tabs__count">4128</span>
      </TabsTrigger>
      <TabsTrigger value="active">
        Active <span className="tabs__count">3907</span>
      </TabsTrigger>
      <TabsTrigger value="invalid">
        Invalid <span className="tabs__count">17</span>
      </TabsTrigger>
      <TabsTrigger value="unsynced">
        Unsynced <span className="tabs__count">204</span>
      </TabsTrigger>
    </TabsList>

    <TabsContent value="all">
      <p className="muted-text">Every mapped offer across all marketplace connections.</p>
    </TabsContent>

    <TabsContent value="active">
      <p className="muted-text">Offers the marketplace reports as live and buyable.</p>
    </TabsContent>

    <TabsContent value="invalid">
      <KeyValueList
        items={[
          {
            label: <span className="mono">14892036711</span>,
            value: 'Category 257 requires a brand parameter.',
          },
          {
            label: <span className="mono">14892036712</span>,
            value: 'EAN 5901234123457 has no catalogue card.',
          },
          {
            label: <span className="mono">14892036718</span>,
            value: 'Title is shorter than the 12-character floor.',
          },
        ]}
      />
    </TabsContent>

    <TabsContent value="unsynced">
      <p className="muted-text">Mapped, but no publication status has been read yet.</p>
    </TabsContent>
  </Tabs>
);
