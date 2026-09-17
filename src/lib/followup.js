      const retryAt = getNextBusinessTime(lead.state);
      updates.status = 'scheduled';
      updates.scheduledCallAt = retryAt;
      // Stagger 0-120s so a wave of callbacks doesn't mature at the same second
      await callQueue.add('make-call', { leadId: lead.id }, {
        delay: Math.max(retryAt - Date.now(), 60000) + Math.floor(Math.random() * 120000),
        priority: leadPriority(lead)
      });
      task = await createTask({
        leadId: lead.id,
        type: 'CALL_BACK',